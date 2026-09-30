import express from 'express';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { createDevCaptureRouter } from './devCapture.js';

const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sleevesnap-dev-capture-test-'));

function freshReportPath(): string {
  return path.join(scratchDir, `report-${Math.random().toString(36).slice(2)}.json`);
}

async function startTestServer(reportFilePath: string): Promise<{ server: http.Server; port: number }> {
  const app = express();
  app.use(express.json({ limit: '20mb' }));
  app.use('/api/dev', createDevCaptureRouter(reportFilePath));

  return await new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        throw new Error('Expected an ephemeral TCP port');
      }
      resolve({ server, port: address.port });
    });
  });
}

async function closeServer(server: http.Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
}

async function getJson(port: number, requestPath: string): Promise<{ statusCode: number; json: any }> {
  return await new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port, path: requestPath, method: 'GET' },
      (res) => {
        let body = '';
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () =>
          resolve({ statusCode: res.statusCode ?? 0, json: body ? JSON.parse(body) : null }),
        );
      },
    );
    req.on('error', reject);
    req.end();
  });
}

async function postJson(port: number, requestPath: string, payload: unknown): Promise<{ statusCode: number; json: any }> {
  return await new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        path: requestPath,
        method: 'POST',
        headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () =>
          resolve({ statusCode: res.statusCode ?? 0, json: data ? JSON.parse(data) : null }),
        );
      },
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

const SAMPLE_REPORT = {
  totalFrames: 3,
  triggerFrame: 2,
  triggerTimeSeconds: 0.4,
  perFrame: [
    { frame: 0, time: 0, detected: false, squareness: 0, fill: 0, stabilityCount: 0, passed: false },
    { frame: 1, time: 0.2, detected: true, squareness: 0.9, fill: 0.4, stabilityCount: 1, passed: true },
    { frame: 2, time: 0.4, detected: true, squareness: 0.92, fill: 0.42, stabilityCount: 2, passed: true },
  ],
};

test('GET /api/dev/capture-report responds 404 when no report has been saved yet', async () => {
  const { server, port } = await startTestServer(freshReportPath());
  try {
    const { statusCode } = await getJson(port, '/api/dev/capture-report');
    assert.equal(statusCode, 404);
  } finally {
    await closeServer(server);
  }
});

test('POST /api/dev/capture-report saves the report and responds 200', async () => {
  const { server, port } = await startTestServer(freshReportPath());
  try {
    const { statusCode } = await postJson(port, '/api/dev/capture-report', SAMPLE_REPORT);
    assert.equal(statusCode, 200);
  } finally {
    await closeServer(server);
  }
});

test('GET /api/dev/capture-report returns exactly what was POSTed', async () => {
  const { server, port } = await startTestServer(freshReportPath());
  try {
    await postJson(port, '/api/dev/capture-report', SAMPLE_REPORT);
    const { statusCode, json } = await getJson(port, '/api/dev/capture-report');
    assert.equal(statusCode, 200);
    assert.deepEqual(json, SAMPLE_REPORT);
  } finally {
    await closeServer(server);
  }
});

test('POST /api/dev/capture-report overwrites a previously saved report', async () => {
  const reportFilePath = freshReportPath();
  const { server, port } = await startTestServer(reportFilePath);
  try {
    await postJson(port, '/api/dev/capture-report', SAMPLE_REPORT);
    const secondReport = { ...SAMPLE_REPORT, totalFrames: 9, triggerFrame: null };
    await postJson(port, '/api/dev/capture-report', secondReport);

    const { json } = await getJson(port, '/api/dev/capture-report');
    assert.deepEqual(json, secondReport);
  } finally {
    await closeServer(server);
  }
});

test('GET /api/dev/capture-report on a fresh router/path still 404s even if another instance wrote elsewhere', async () => {
  const pathA = freshReportPath();
  const pathB = freshReportPath();
  const serverA = await startTestServer(pathA);
  const serverB = await startTestServer(pathB);
  try {
    await postJson(serverA.port, '/api/dev/capture-report', SAMPLE_REPORT);
    const { statusCode } = await getJson(serverB.port, '/api/dev/capture-report');
    assert.equal(statusCode, 404);
  } finally {
    await closeServer(serverA.server);
    await closeServer(serverB.server);
  }
});
