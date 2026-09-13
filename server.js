'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const querystring = require('querystring');

const PORT = Number(process.env.PORT || 3000);
const COMMUNITY_ID = '142430';
const FURTHER_API_URL =
  process.env.FURTHER_API_URL ||
  'https://api.talkfurther.com/api/chat/leads/ingestion/zapier-webhook';
const FURTHER_API_KEY = process.env.FURTHER_API_KEY;

const PUBLIC_DIR = path.join(__dirname, 'public');
const VALIDATION_LOG = path.join(__dirname, 'logs', 'validation-failures.jsonl');

fs.mkdirSync(path.dirname(VALIDATION_LOG), { recursive: true });

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function normalizePhone(phone = '') {
  return String(phone).replace(/\D/g, '');
}

function isValidEmail(email = '') {
  // Intentionally practical rather than attempting full RFC 5322 validation.
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email).trim());
}

function validateLead(input) {
  const lead = {
    first_name: String(input.first_name || '').trim(),
    last_name: String(input.last_name || '').trim(),
    email: String(input.email || '').trim(),
    phone: normalizePhone(input.phone),
  };

  const errors = [];

  if (!lead.first_name) errors.push('First name is required.');
  if (!lead.last_name) errors.push('Last name is required.');
  if (!isValidEmail(lead.email)) errors.push('Enter a valid email address.');
  if (lead.phone.length !== 10) errors.push('Phone number must contain exactly 10 digits.');

  return { lead, errors };
}

function logValidationFailure(rawInput, errors) {
  const record = {
    timestamp: new Date().toISOString(),
    reason: 'validation_failed',
    errors,
    // This is intentionally a local exercise log. In production I would minimize/redact PII
    // and send structured events to a centralized logging system with retention controls.
    submitted: {
      first_name: rawInput.first_name || '',
      last_name: rawInput.last_name || '',
      email: rawInput.email || '',
      phone: rawInput.phone || '',
    },
  };

  fs.appendFileSync(VALIDATION_LOG, `${JSON.stringify(record)}\n`, 'utf8');
}

async function postLeadToFurther(lead) {
  if (!FURTHER_API_KEY) {
    throw new Error('FURTHER_API_KEY is not configured on the server.');
  }

  const form = new FormData();
  form.append('community_id', COMMUNITY_ID);
  form.append('first_name', lead.first_name);
  form.append('last_name', lead.last_name);
  form.append('email', lead.email);
  form.append('phone', lead.phone);

  const response = await fetch(FURTHER_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Api-Key ${FURTHER_API_KEY}`,
    },
    body: form,
  });

  const responseText = await response.text();
  let responseBody;

  try {
    responseBody = responseText ? JSON.parse(responseText) : {};
  } catch {
    responseBody = { raw: responseText };
  }

  if (!response.ok) {
    const error = new Error(`Further API returned HTTP ${response.status}.`);
    error.status = response.status;
    error.details = responseBody;
    throw error;
  }

  return responseBody;
}

function serveIndex(res) {
  fs.readFile(path.join(PUBLIC_DIR, 'index.html'), (err, data) => {
    if (err) {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Unable to load the form.');
      return;
    }

    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(data);
  });
}

function collectRequestBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 1_000_000) {
        reject(new Error('Request body too large.'));
        req.destroy();
      }
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/') {
    serveIndex(res);
    return;
  }

  if (req.method === 'POST' && req.url === '/submit') {
    try {
      const body = await collectRequestBody(req);
      const input = querystring.parse(body);
      const { lead, errors } = validateLead(input);

      if (errors.length) {
        logValidationFailure(input, errors);
        sendJson(res, 400, {
          ok: false,
          message: errors.join(' '),
          errors,
        });
        return;
      }

      const result = await postLeadToFurther(lead);
      sendJson(res, 200, {
        ok: true,
        message: 'Lead submitted successfully.',
        lead: {
          further_lead_id: result.further_lead_id ?? null,
          external_lead_id: result.external_lead_id ?? null,
          community_code: result.community_code ?? null,
        },
      });
    } catch (error) {
      console.error('Submission failed:', error);
      sendJson(res, error.status && error.status >= 400 && error.status < 600 ? 502 : 500, {
        ok: false,
        message: 'We could not submit the lead right now. Please try again or contact support.',
      });
    }
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Not found');
});

server.listen(PORT, () => {
  console.log(`Lead form running at http://localhost:${PORT}`);
});
