require('dotenv').config();
const express = require('express');
const { google } = require('googleapis');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
);

app.get('/auth/login', (req, res) => {
    const url = oauth2Client.generateAuthUrl({
        access_type: 'offline',
        prompt: 'consent',
        scope: [
            'https://www.googleapis.com/auth/userinfo.email',
            'https://www.googleapis.com/auth/spreadsheets.readonly',
            'https://www.googleapis.com/auth/calendar.events'
        ]
    });
    res.redirect(url);
});

app.get('/auth/callback', async (req, res) => {
    const { code } = req.query;

    if (!code) {
        return res.status(400).send('인증 코드가 없습니다.');
    }

    try {
        const { tokens } = await oauth2Client.getToken(code);
        oauth2Client.setCredentials(tokens);

        const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
        const userInfo = await oauth2.userinfo.get();
        const email = userInfo.data.email;

        if (!tokens.refresh_token) {
            return res.send(
                `<h2>이미 연동된 계정입니다.</h2><p>재연동하려면 구글 계정 설정에서 앱 권한을 제거한 후 다시 시도하세요.</p>`
            );
        }

        const { error } = await supabase.from('users').upsert({
            email: email,
            refresh_token: tokens.refresh_token,
            access_token: tokens.access_token,
            expires_at: tokens.expiry_date
        });

        if (error) throw error;

        res.send(`<h1>연동 성공!</h1><p>${email} 계정이 등록되었습니다.</p>`);
    } catch (err) {
        console.error('인증 에러:', err);
        res.status(500).send('인증 실패: ' + err.message);
    }
});

app.listen(process.env.PORT, () => {
    console.log(`서버 실행 중: http://localhost:${process.env.PORT}`);
});
