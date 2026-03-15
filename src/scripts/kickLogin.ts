/**
 * One-time PKCE login script for Kick OAuth.
 * Run with: node --loader ts-node/esm src/scripts/kickLogin.ts
 *
 * Requires KICK_CLIENT_ID and KICK_CLIENT_SECRET in your .env.
 * Redirect URL registered in your Kick app must be http://localhost:3000
 */

import crypto from 'node:crypto';
import http from 'node:http';
import { URL } from 'node:url';
import axios from 'axios';
import dotenv from 'dotenv';
import { saveTokens } from '../auth/tokenStore.js';

dotenv.config();

const CLIENT_ID = process.env.KICK_CLIENT_ID;
const CLIENT_SECRET = process.env.KICK_CLIENT_SECRET;
const REDIRECT_URI = process.env.KICK_REDIRECT_URI ?? 'http://localhost:3000';
const PORT = Number(new URL(REDIRECT_URI).port || 80);

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('Missing KICK_CLIENT_ID or KICK_CLIENT_SECRET in .env');
  process.exit(1);
}

function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

const codeVerifier = base64url(crypto.randomBytes(32));
const codeChallenge = base64url(crypto.createHash('sha256').update(codeVerifier).digest());
const state = base64url(crypto.randomBytes(16));

const authUrl = new URL('https://id.kick.com/oauth/authorize');
authUrl.searchParams.set('client_id', CLIENT_ID);
authUrl.searchParams.set('response_type', 'code');
authUrl.searchParams.set('redirect_uri', REDIRECT_URI);
authUrl.searchParams.set('scope', 'chat:write events:subscribe');
authUrl.searchParams.set('state', state);
authUrl.searchParams.set('code_challenge', codeChallenge);
authUrl.searchParams.set('code_challenge_method', 'S256');

console.log('\nOpen this URL in your browser:\n');
console.log(authUrl.toString());
console.log('\nWaiting for callback on', REDIRECT_URI, '...\n');

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
  const code = url.searchParams.get('code');
  const returnedState = url.searchParams.get('state');

  if (!code) {
    res.writeHead(400);
    res.end('Missing code parameter.');
    return;
  }

  if (returnedState !== state) {
    res.writeHead(400);
    res.end('State mismatch. Possible CSRF.');
    return;
  }

  try {
    const params = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      client_id: CLIENT_ID!,
      client_secret: CLIENT_SECRET!,
      redirect_uri: REDIRECT_URI,
      code_verifier: codeVerifier,
    });

    const tokenRes = await axios.post('https://id.kick.com/oauth/token', params.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });

    saveTokens({
      accessToken: tokenRes.data.access_token,
      refreshToken: tokenRes.data.refresh_token,
      expiresAt: Date.now() + (tokenRes.data.expires_in ?? 3600) * 1000,
    });

    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Login successful! You can close this tab.');
    console.log('Tokens saved to data/tokens.json');
  } catch (err) {
    const message = (err as Error).message;
    res.writeHead(500);
    res.end(`Token exchange failed: ${message}`);
    console.error('Token exchange failed:', err);
  } finally {
    server.close();
  }
});

server.listen(PORT);
