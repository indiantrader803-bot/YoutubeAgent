const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');

const credentialsPath = path.join(__dirname, '..', 'config', 'credentials.json');
const tokensPath = path.join(__dirname, '..', 'config', 'tokens.json');

const code = "4/0AXEQxIB1i1B0hn3aJDd1_b3ha0paILVdeLz_FPtZD3NFEdWGxa3a1wsPHV5Eyr8w3iU1Kw";
const redirectUri = "http://localhost:8561/callback";

async function main() {
  try {
    const credentials = JSON.parse(fs.readFileSync(credentialsPath));
    const oauth2Client = new google.auth.OAuth2(
      credentials.youtube.client_id,
      credentials.youtube.client_secret,
      redirectUri
    );

    console.log("Exchanging authorization code for tokens...");
    const { tokens } = await oauth2Client.getToken(code);
    
    // Save tokens
    const tokenData = { youtube: tokens };
    fs.writeFileSync(tokensPath, JSON.stringify(tokenData, null, 2));
    console.log("Tokens exchanged and saved successfully to config/tokens.json!");

    // Test token
    oauth2Client.setCredentials(tokens);
    const youtube = google.youtube({ version: 'v3', auth: oauth2Client });
    const response = await youtube.channels.list({
      part: 'snippet',
      mine: true
    });
    
    if (response.data.items && response.data.items.length > 0) {
      console.log(`Connected to channel: ${response.data.items[0].snippet.title}`);
    } else {
      console.log("Authentication succeeded, but no channel was found.");
    }
  } catch (error) {
    console.error("Token exchange failed:", error.message);
  }
}

main();
