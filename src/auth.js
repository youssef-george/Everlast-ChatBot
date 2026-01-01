export const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:4000'

export async function login(identifier, password) {
  const res = await fetch(`${API_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier, password })
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || 'Login failed')
  return data
}

export async function fetchMe(token) {
  const res = await fetch(`${API_BASE}/auth/me`, {
    headers: { Authorization: `Bearer ${token}` }
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || 'Unauthorized')
  return data
}

export async function getChatStatuses() {
  const res = await fetch(`${API_BASE}/chat-status`)
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || 'Failed to fetch chat statuses')
  return data.statuses || {}
}

export async function setChatStatus(chatId, enabled) {
  const res = await fetch(`${API_BASE}/chat-status`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, enabled })
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || 'Failed to update chat status')
  return data
}

export async function adminCreateUser(token, { username, password, email, role }) {
  const res = await fetch(`${API_BASE}/admin/users`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      Authorization: `Bearer ${token || ''}`,
    },
    body: JSON.stringify({ username, password, email, role }),
  })
  const contentType = res.headers.get('content-type') || ''
  const data = contentType.includes('application/json') ? await res.json() : { error: await res.text() }
  if (!res.ok) {
    if (res.status === 401) throw new Error(data.error || 'Unauthorized. Please sign in again.')
    if (res.status === 403) throw new Error(data.error || 'Forbidden')
    if (res.status === 409) throw new Error(data.error || 'Conflict')
    throw new Error(data.error || 'Failed to create user')
  }
  return data.user
}

export async function adminListUsers(token) {
  const res = await fetch(`${API_BASE}/admin/users`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  const contentType = res.headers.get('content-type') || ''
  if (!contentType.includes('application/json')) {
    const text = await res.text()
    throw new Error(`HTTP ${res.status} ${res.statusText}: ${text?.slice(0, 180)}`)
  }
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || 'Failed to fetch users')
  return data.users || []
}

export async function adminDeleteUser(token, id) {
  const res = await fetch(`${API_BASE}/admin/users/${id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  })
  const contentType = res.headers.get('content-type') || ''
  if (!contentType.includes('application/json')) {
    const text = await res.text()
    throw new Error(`HTTP ${res.status} ${res.statusText}: ${text?.slice(0, 180)}`)
  }
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || 'Failed to delete user')
  return data
}


