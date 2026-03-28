// js/api.js
import { authToken } from './state.js';

export const API_URL = window.location.hostname.includes('localhost') || window.location.hostname.includes('127.0.0.1')
    ? 'http://localhost:5000/api'
    : '/api';

export const apiAuthRequest = async (endpoint, email, password) => {
    const res = await fetch(`${API_URL}/auth/${endpoint}`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ email, password })
    });
    return res;
};

export const apiFetchData = async () => {
    if(!authToken) throw new Error("No token");
    return await fetch(`${API_URL}/data`, { headers: { 'x-auth-token': authToken } });
};

export const apiSaveData = async (dbPayload) => {
    if(!authToken) return;
    const res = await fetch(`${API_URL}/data`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-auth-token': authToken },
        body: JSON.stringify(dbPayload)
    });
    if (!res.ok) throw new Error("Falha na sincronização com o servidor.");
    return res;
};

export const apiSaveIncremental = async (payload) => {
    if(!authToken) return;
    const res = await fetch(`${API_URL}/estudos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-auth-token': authToken },
        body: JSON.stringify(payload)
    });
    if (!res.ok) throw new Error("Falha na sincronização parcial.");
    return await res.json();
};

export const apiUpdateRevisionStatus = async (studyId, revIndex) => {
    if(!authToken) return;
    const res = await fetch(`${API_URL}/estudos/revisao`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'x-auth-token': authToken },
        body: JSON.stringify({ studyId, revIndex })
    });
    if (!res.ok) throw new Error("Falha ao atualizar revisão.");
    return await res.json();
};