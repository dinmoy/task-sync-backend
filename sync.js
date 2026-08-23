require('dotenv').config();

const { google } = require('googleapis');
const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const SHEET_ID = process.env.SHEET_ID
const SHEET_RANGE = "'업무정리'!A2:L";

const COL = {
    TASK: 2,      // C열 = 업무
    OPEN_DATE: 6, // G열 = 오픈일(2026.08.11 형식)
    ASSIGNEE: 8,  // I열 = 담당자
};


function parseCustomDate(dateStr) {
    if (!dateStr) return null;

    const parts = String(dateStr).split('.').map(p => p.trim()).filter(Boolean);

    if (parts.length !== 3) return null;

    const [year, month, day] = parts.map(Number);

    if (!year || !month || !day) return null;
    return new Date(year, month - 1, day);
}

function toDateOnlyString(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

function createAuthClient(user) {
    const oauth2Client = new google.auth.OAuth2(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET,
        process.env.GOOGLE_REDIRECT_URI
    );

    oauth2Client.setCredentials({
        refresh_token: user.refresh_token,
        access_token: user.access_token,
        expiry_date: user.expires_at,
    });

    return oauth2Client;
}

async function syncTasks() {
    console.log('=== 동기화 시작:', new Date().toLocaleString(), '===');

    const { data: users, error: userError } = await supabase.from('users').select('*');

    if (userError) {
        throw new Error(`유저 조회 실패: ${userError.message}`);
    }

    if (!users || users.length === 0) {
        console.log('등록된 유저가 없습니다.');
        return;
    }

    for (const user of users) {
        if (!user.display_name) continue;

        const auth = createAuthClient(user);

        const sheets = google.sheets({ version: 'v4', auth });
        const calendar = google.calendar({ version: 'v3', auth });

        let rows;
        try {
            const res = await sheets.spreadsheets.values.get({
                spreadsheetId: SHEET_ID,
                range: SHEET_RANGE,
            });
            rows = res.data.values || [];
        } catch (err) {
            console.error(`[${user.display_name}] 시트 읽기 실패:`, err.message);
            continue;
        }

        for (const row of rows) {
            const taskName = row[COL.TASK];
            const assignee = row[COL.ASSIGNEE];
            const openDateStr = row[COL.OPEN_DATE];

            if (!assignee || assignee.trim() !== user.display_name) continue;

            const openDate = parseCustomDate(openDateStr);
            if (!openDate) continue;

            const dateOnly = toDateOnlyString(openDate);

            const taskId = crypto.createHash('md5').update(`${taskName}_${dateOnly}`).digest('hex');

            try {
                const existing = await calendar.events.list({
                    calendarId: 'primary',
                    privateExtendedProperty: `taskId=${taskId}`,
                });

                if (existing.data.items && existing.data.items.length > 0) continue; // 이미 등록됨

                const event = {
                    summary: `[오픈] ${taskName}`,
                    start: { date: dateOnly },
                    end: { date: dateOnly },
                    visibility: 'private',
                    extendedProperties: {
                        private: { taskId },
                    },
                }

                await calendar.events.insert({
                    calendarId: 'primary',
                    resource : event
                });

                console.log(`[${user.display_name}] 등록 완료: ${taskName} (${dateOnly})`);
            } catch (err) {
                console.error(`[${user.display_name}] 에러 (${taskName}):`, err.message);
            }
        }
    }
}

syncTasks();
