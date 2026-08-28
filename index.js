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

function renderPage({title, message, tone = 'default', showButton = false}) {
    const toneColor = {
        default: '#4f46e5',
        success: '#16a34a',
        error: '#dc2626',
        info: '#2563eb',
    }[tone];

    return `
    <!DOCTYPE html>
    <html lang="ko">
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <title>${title}</title>
      <style>
        body {
          margin: 0;
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          background: #f4f4f6;
          font-family: -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", "Malgun Gothic", sans-serif;
        }
        .card {
          background: #ffffff;
          border-radius: 16px;
          box-shadow: 0 4px 20px rgba(0,0,0,0.08);
          padding: 48px 40px;
          max-width: 420px;
          width: 90%;
          text-align: center;
        }
        .badge {
          display: inline-block;
          width: 56px;
          height: 56px;
          border-radius: 50%;
          background: ${toneColor}1a;
          color: ${toneColor};
          font-size: 28px;
          line-height: 56px;
          margin-bottom: 20px;
        }
        h1 {
          font-size: 20px;
          margin: 0 0 12px;
          color: #111827;
        }
        p {
          font-size: 14px;
          color: #6b7280;
          line-height: 1.6;
          margin: 0 0 24px;
        }
        a.button {
          display: inline-block;
          background: ${toneColor};
          color: #fff;
          text-decoration: none;
          padding: 12px 28px;
          border-radius: 8px;
          font-size: 14px;
          font-weight: 600;
        }
      </style>
    </head>
    <body>
      <div class="card">
        <div class="badge">${tone === 'success' ? '✓' : tone === 'error' ? '!' : '📅'}</div>
        <h1>${title}</h1>
        <p>${message}</p>
        ${showButton ? '<a class="button" href="/auth/login">구글 계정으로 연동하기</a>' : ''}
      </div>
    </body>
    </html>
  `;
}

app.get('/', (req, res) => {
    res.send(renderPage({
        title: 'TASKY',
        message: '구글 계정을 연동하면, 공용 시트에 등록된 본인 업무의 오픈일이 자동으로 구글 캘린더에 등록됩니다.',
        showButton: true,
    }));
});

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
        return res.status(400).send(renderPage({
            title: '인증 코드가 없습니다',
            message: '잘못된 접근이거나 인증 과정이 중간에 취소됐어요. 다시 시도해주세요.',
            tone: 'error',
            showButton: true,
        }));
    }

    try {
        const { tokens } = await oauth2Client.getToken(code);
        oauth2Client.setCredentials(tokens);

        const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
        const userInfo = await oauth2.userinfo.get();
        const email = userInfo.data.email;

        if (!tokens.refresh_token) {
            return res.send(renderPage({
                title: '이미 연동된 계정입니다',
                message: '재연동하려면 구글 계정 설정에서 앱 권한을 제거한 후 다시 시도해주세요.',
                tone: 'info',
            }));
        }

        const { error } = await supabase.from('users').upsert({
            email: email,
            refresh_token: tokens.refresh_token,
            access_token: tokens.access_token,
            expires_at: tokens.expiry_date
        });

        if (error) throw error;

        res.send(renderPage({
            title: '연동 성공!',
            message: `${email} 계정이 등록됐어요. 앞으로 공용 시트에 이름이 올라오면 자동으로 캘린더에 일정이 등록됩니다.`,
            tone: 'success',
        }));
    } catch (err) {
        console.error('인증 에러:', err);
        res.status(500).send(renderPage({
            title: '인증 실패',
            message: err.message,
            tone: 'error',
            showButton: true,
        }));
    }
});

app.listen(process.env.PORT, () => {
    console.log(`서버 실행 중: http://localhost:${process.env.PORT}`);
});
