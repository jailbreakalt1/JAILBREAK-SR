'use strict';

const axios = require('axios');
const crypto = require('node:crypto');
const config = require('../config');

const BASE_URL = (config.orchestrator && config.orchestrator.url) ? config.orchestrator.url.replace(/\/+$/, '') : '';
const TOKEN = config.orchestrator?.token || '';
const DEFAULT_WORKER_ID = config.orchestrator?.workerId || `bot-${crypto.randomUUID().slice(0, 8)}`;

function requestId() {
  return crypto.randomUUID();
}

async function orchestratorApi(method, path, body) {
  if (!BASE_URL || !TOKEN) throw new Error('Orchestrator not configured');
  const url = `${BASE_URL}${path}`;
  const res = await axios({
    method,
    url,
    data: body,
    timeout: 10000,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${TOKEN}`,
    },
    validateStatus: () => true,
  });
  if (res.status >= 400) {
    const err = new Error(`Orchestrator ${method} ${path} failed: ${res.status}`);
    err.status = res.status;
    err.data = res.data;
    throw err;
  }
  return res.data;
}

async function submitJob(command, payload, userId) {
  const requestKey = `${userId}:${command}:${Date.now()}:${requestId().slice(0, 8)}`;
  return orchestratorApi('POST', '/api/jobs/submit', {
    requestKey,
    userId,
    command,
    payload,
  });
}

async function getJobStatus(jobId) {
  return orchestratorApi('GET', `/api/jobs/${jobId}`);
}

async function checkQuota(userId) {
  return orchestratorApi('POST', '/api/quota/check', { userId });
}

async function getOrchestratorStatus() {
  return orchestratorApi('GET', '/api/status');
}

const orchestratorClient = {
  submitJob,
  getJobStatus,
  checkQuota,
  getOrchestratorStatus,
  BASE_URL,
  TOKEN,
  DEFAULT_WORKER_ID,
};

module.exports = { orchestratorClient };