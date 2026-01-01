import { useEffect, useMemo, useState } from 'react'
import { login } from './auth'
import './index.css'

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const usernameRegex = /^[a-zA-Z0-9._-]{3,20}$/
const passwordRegex = /^(?=.*[A-Za-z])(?=.*\d).{8,}$/

export default function Login({ onSuccess }) {
  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const [touched, setTouched] = useState({ identifier: false, password: false })
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const identifierValid = useMemo(() => {
    if (!identifier) return false
    return emailRegex.test(identifier) || usernameRegex.test(identifier)
  }, [identifier])

  const passwordValid = useMemo(() => passwordRegex.test(password), [password])

  const canSubmit = identifierValid && passwordValid && !submitting

  useEffect(() => {
    setError('')
  }, [identifier, password])

  const onSubmit = async (e) => {
    e.preventDefault()
    setTouched({ identifier: true, password: true })
    if (!canSubmit) return
    try {
      setSubmitting(true)
      const { token, user } = await login(identifier, password)
      localStorage.setItem('auth_token', token)
      localStorage.setItem('auth_user', JSON.stringify(user))
      onSuccess?.({ token, user })
    } catch (err) {
      setError(err.message || 'Login failed')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="login-wrapper">
      <div className="login-card">
        <div className="login-blob" />
        <h1 className="login-title">Welcome back</h1>
        <p className="login-subtitle">Sign in to continue</p>
        {error ? <div className="form-error fade-in">{error}</div> : null}
        <form className="login-form" onSubmit={onSubmit} noValidate>
          <div className={`form-group ${touched.identifier && !identifierValid ? 'has-error' : ''}`}>
            <label className="form-label">Email or Username</label>
            <div className="input-wrap">
              <input
                className="form-input"
                type="text"
                placeholder="e.g. user or user@example.com"
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value.trim())}
                onBlur={() => setTouched((t) => ({ ...t, identifier: true }))}
                autoFocus
              />
              <span className="input-icon">@</span>
            </div>
            {touched.identifier && !identifier && (
              <div className="field-hint">Identifier is required.</div>
            )}
            {touched.identifier && identifier && !identifierValid && (
              <div className="field-hint">Use a valid email or 3-20 char username.</div>
            )}
          </div>

          <div className={`form-group ${touched.password && !passwordValid ? 'has-error' : ''}`}>
            <label className="form-label">Password</label>
            <div className="input-wrap">
              <input
                className="form-input"
                type="password"
                placeholder="At least 8 chars, 1 letter & 1 number"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onBlur={() => setTouched((t) => ({ ...t, password: true }))}
              />
              <span className="input-icon">•</span>
            </div>
            {touched.password && !password && (
              <div className="field-hint">Password is required.</div>
            )}
            {touched.password && password && !passwordValid && (
              <div className="field-hint">Min 8 chars with at least 1 letter and 1 number.</div>
            )}
          </div>

          <button className={`btn-primary ${submitting ? 'loading' : ''}`} disabled={!canSubmit} type="submit">
            {submitting ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

 
      </div>
    </div>
  )
}


