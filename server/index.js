import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import jwt from 'jsonwebtoken'
import bcrypt from 'bcryptjs'
import fetch from 'node-fetch'
import { Pool } from 'pg'

dotenv.config()

const app = express()
app.use(cors())
app.use(express.json())

const DATABASE_URL = process.env.DATABASE_URL || "postgresql://neondb_owner:npg_Q1bzKpqk6ylw@ep-frosty-thunder-ad1m8ol5-pooler.c-2.us-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require"
const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret_change_me'
const PORT = process.env.PORT || 4000

const pool = new Pool({ connectionString: DATABASE_URL, max: 3, idleTimeoutMillis: 30_000 })

async function ensureDatabaseAwake() {
  try {
    await pool.query('SELECT 1')
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('DB wake error:', err.message)
  }
}

async function initSchema() {
  await ensureDatabaseAwake()
  await pool.query(`
    CREATE EXTENSION IF NOT EXISTS pgcrypto;
    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      username TEXT UNIQUE,
      email TEXT UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS chat_status (
      chat_id TEXT PRIMARY KEY,
      enabled BOOLEAN NOT NULL DEFAULT false,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    ALTER TABLE chat_status ADD COLUMN IF NOT EXISTS enabled BOOLEAN NOT NULL DEFAULT false;
    ALTER TABLE chat_status ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
  `)
}

async function seedAdmin() {
  const adminUsername = 'admin'
  const adminPassword = 'admin@123'
  const adminRole = 'admin'

  // check exists by username
  const { rows } = await pool.query('SELECT id FROM users WHERE username = $1', [adminUsername])
  if (rows.length > 0) return

  const passwordHash = await bcrypt.hash(adminPassword, 10)
  await pool.query(
    'INSERT INTO users (username, password_hash, role) VALUES ($1, $2, $3)',
    [adminUsername, passwordHash, adminRole]
  )
}

function signToken(user) {
  const payload = { sub: user.id, username: user.username, role: user.role }
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' })
}

function authMiddleware(req, res, next) {
  const header = req.headers.authorization || ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : null
  if (!token) return res.status(401).json({ error: 'Missing token' })
  try {
    const decoded = jwt.verify(token, JWT_SECRET)
    req.user = decoded
    return next()
  } catch {
    return res.status(401).json({ error: 'Invalid token' })
  }
}

app.get('/health', async (_req, res) => {
  try {
    await ensureDatabaseAwake()
    return res.json({ ok: true })
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message })
  }
})

// Dev-only: re-run schema and seeding
app.post('/debug/init', async (_req, res) => {
  try {
    await initSchema()
    await seedAdmin()
    return res.json({ ok: true })
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message })
  }
})

app.get('/debug/describe', async (_req, res) => {
  try {
    const { rows } = await pool.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_name='chat_status' ORDER BY ordinal_position")
    return res.json({ columns: rows })
  } catch (e) {
    return res.status(500).json({ error: e.message })
  }
})

app.post('/auth/login', async (req, res) => {
  const { identifier, password } = req.body || {}
  if (!identifier || !password) return res.status(400).json({ error: 'Identifier and password are required' })

  // Wake Neon before real query to avoid cold start latency
  await ensureDatabaseAwake()

  // determine if identifier is email
  const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identifier)
  const where = isEmail ? 'email = $1' : 'username = $1'
  const values = [identifier]
  try {
    const { rows } = await pool.query(`SELECT id, username, email, password_hash, role FROM users WHERE ${where} LIMIT 1`, values)
    if (rows.length === 0) return res.status(401).json({ error: 'Invalid credentials' })

    const user = rows[0]
    const isValid = await bcrypt.compare(password, user.password_hash)
    if (!isValid) return res.status(401).json({ error: 'Invalid credentials' })

    const token = signToken(user)
    return res.json({ token, user: { id: user.id, username: user.username, email: user.email, role: user.role } })
  } catch (e) {
    return res.status(500).json({ error: 'Login failed' })
  }
})

app.get('/auth/me', authMiddleware, async (req, res) => {
  return res.json({ user: req.user })
})

// Chat status endpoints
app.get('/chat-status', async (_req, res) => {
  try {
    const { rows } = await pool.query('SELECT chat_id, enabled FROM chat_status')
    const map = {}
    for (const r of rows) map[r.chat_id] = r.enabled
    return res.json({ statuses: map })
  } catch (e) {
    return res.status(500).json({ error: 'Failed to fetch chat status', detail: e.message })
  }
})

app.post('/chat-status', async (req, res) => {
  const { chat_id: chatId, enabled } = req.body || {}
  if (!chatId || typeof enabled !== 'boolean') return res.status(400).json({ error: 'chat_id and enabled required' })
  try {
    await pool.query(
      `INSERT INTO chat_status (chat_id, enabled, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (chat_id) DO UPDATE SET enabled = EXCLUDED.enabled, updated_at = NOW()`,
      [chatId, enabled]
    )
    return res.json({ ok: true })
  } catch (e) {
    return res.status(500).json({ error: 'Failed to update chat status' })
  }
})

// Admin: create user (admin only)
app.post('/admin/users', authMiddleware, async (req, res) => {
  try {
    const requester = req.user
    if (!requester || requester.role !== 'admin') return res.status(403).json({ error: 'Forbidden' })
    const { username, password, email, role } = req.body || {}
    if (!username || !password) return res.status(400).json({ error: 'username and password are required' })
    const existing = await pool.query('SELECT id FROM users WHERE username=$1', [username])
    if (existing.rows.length) return res.status(409).json({ error: 'Username already exists' })
    const hash = await bcrypt.hash(password, 10)
    const userRole = role && role === 'admin' ? 'admin' : 'user'
    const { rows } = await pool.query(
      'INSERT INTO users (username, email, password_hash, role) VALUES ($1,$2,$3,$4) RETURNING id, username, email, role, created_at',
      [username, email || null, hash, userRole]
    )
    return res.json({ user: rows[0] })
  } catch (e) {
    return res.status(500).json({ error: 'Failed to create user' })
  }
})

// Admin: list users (admin only)
app.get('/admin/users', authMiddleware, async (req, res) => {
  try {
    const requester = req.user
    if (!requester || requester.role !== 'admin') return res.status(403).json({ error: 'Forbidden' })
    const { rows } = await pool.query('SELECT id, username, email, role, created_at FROM users ORDER BY created_at DESC')
    return res.json({ users: rows })
  } catch (e) {
    return res.status(500).json({ error: 'Failed to fetch users' })
  }
})

// Admin: delete user (admin only)
app.delete('/admin/users/:id', authMiddleware, async (req, res) => {
  try {
    const requester = req.user
    if (!requester || requester.role !== 'admin') return res.status(403).json({ error: 'Forbidden' })
    const { id } = req.params
    // Prevent self-delete optionally
    if (requester.sub === id) return res.status(400).json({ error: 'Cannot delete yourself' })
    const result = await pool.query('DELETE FROM users WHERE id = $1', [id])
    return res.json({ ok: true, deleted: result.rowCount })
  } catch (e) {
    return res.status(500).json({ error: 'Failed to delete user' })
  }
})

;(async () => {
  try {
    await initSchema()
    await seedAdmin()
    app.listen(PORT, () => {
      // eslint-disable-next-line no-console
      console.log(`Server running on http://localhost:${PORT}`)
    })
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('Startup error:', e)
    process.exit(1)
  }
})()


