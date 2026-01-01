import { useEffect, useMemo, useRef, useState } from 'react'
import Login from './Login'
import './App.css'
import { getChatStatuses, setChatStatus, adminCreateUser, adminListUsers, adminDeleteUser } from './auth'

const GET_API = 'https://n8n.maprojects.net/webhook/b568befd-ecd2-48b8-8199-9a52292c8a7b'
const POST_API =   'https://n8n.maprojects.net/webhook/b568befd-ecd2-48b8-8199-9a52292c8a7b'
const TOGGLE_API = 'https://n8n.maprojects.net/webhook/b568befd-ecd2-48b8-8199-9a52292c8a7b'
const STORAGE_KEY = 'telegram_chats'
const TOGGLE_STORAGE_KEY = 'chat_toggles'

function formatMessageTime(timestamp) {
  if (!timestamp) return ''
  const date = new Date(timestamp)
  return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true })
}

function formatChatTime(timestamp) {
  if (!timestamp) return ''
  const date = new Date(timestamp)
  const now = new Date()
  const diff = now - date
  const days = Math.floor(diff / (1000 * 60 * 60 * 24))
  if (days === 0) return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
  if (days === 1) return 'Yesterday'
  if (days < 7) return date.toLocaleDateString('en-US', { weekday: 'short' })
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function formatMessageTextToNodes(text) {
  if (!text) return null
  return text
    .replace(/\n/g, '\n')
    .split(/\n/g)
    .map((line, idx) => (
      <span key={idx}>
        {line}
        {idx < text.length - 1 ? <br /> : null}
      </span>
    ))
}

function App() {
  const [authToken, setAuthToken] = useState(() => typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null)
  const [authUser, setAuthUser] = useState(() => {
    try {
      const raw = typeof window !== 'undefined' ? localStorage.getItem('auth_user') : null
      return raw ? JSON.parse(raw) : null
    } catch {
      return null
    }
  })

  return authToken
    ? <ChatApp authUser={authUser} />
    : <Login onSuccess={({ token, user }) => { setAuthToken(token); setAuthUser(user) }} />
}

function ChatApp({ authUser }) {
  const [chatsData, setChatsData] = useState({})
  const [chatToggles, setChatToggles] = useState({})
  const [currentChatId, setCurrentChatId] = useState(null)
  const [isActiveChat, setIsActiveChat] = useState(false)
  const [currentMessages, setCurrentMessages] = useState(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [activePage, setActivePage] = useState('chats') // 'chats' | 'admin' (menu) | 'admin-dashboard' | 'admin-add-user' | 'crm' (menu) | 'crm-leads' | 'crm-reports'
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const chatsPollingRef = useRef(null)
  const messagePollingRef = useRef(null)
  const [lastActivity, setLastActivity] = useState(Date.now())
  const [isTabVisible, setIsTabVisible] = useState(true)

  // Load from localStorage and server on mount
  useEffect(() => {
    try {
      const storedChats = localStorage.getItem(STORAGE_KEY)
      if (storedChats) {
        const parsed = JSON.parse(storedChats)
        if (Array.isArray(parsed)) {
          const obj = {}
          parsed.forEach((c) => {
            obj[c.chat_id] = c
          })
          setChatsData(obj)
        } else if (typeof parsed === 'object') {
          setChatsData(parsed)
        }
      }
    } catch {}
    ;(async () => {
      try {
        const map = await getChatStatuses()
        if (map && typeof map === 'object') setChatToggles(map)
      } catch {}
      try {
        const storedToggles = localStorage.getItem(TOGGLE_STORAGE_KEY)
        if (storedToggles && Object.keys(JSON.parse(storedToggles) || {}).length && Object.keys(chatToggles || {}).length === 0) {
          setChatToggles(JSON.parse(storedToggles) || {})
        }
      } catch {}
    })()
  }, [])

  // Persist chats and toggles
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(chatsData))
    } catch {}
  }, [chatsData])
  useEffect(() => {
    try {
      localStorage.setItem(TOGGLE_STORAGE_KEY, JSON.stringify(chatToggles))
    } catch {}
  }, [chatToggles])

  // Fetch chats and start polling (automatic)
  const fetchChats = async () => {
    try {
      const response = await fetch(GET_API)
      const data = await response.json()
      let chatsArray = []
      if (Array.isArray(data)) chatsArray = data
      else if (data && data.chat_id) chatsArray = [data]
      if (chatsArray.length === 0) return
      setChatsData((prev) => {
        const updated = { ...prev }
        let changed = false
        chatsArray.forEach((chat) => {
          const existing = updated[chat.chat_id]
          const next = {
            chat_id: chat.chat_id,
            user_name: chat.user_name,
            last_message_time: chat.last_message_time,
            unread_count: chat.unread_count || 0,
          }
          if (!existing || JSON.stringify(existing) !== JSON.stringify(next)) {
            updated[chat.chat_id] = next
            changed = true
          }
        })
        return changed ? updated : prev
      })
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('Error fetching chats', e)
    }
  }

  // Page Visibility API listener
  useEffect(() => {
    const handleVisibilityChange = () => {
      setIsTabVisible(!document.hidden)
    }
    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange)
  }, [])

  // Activity tracking
  useEffect(() => {
    const updateActivity = () => {
      setLastActivity(Date.now())
    }

    window.addEventListener('mousemove', updateActivity)
    window.addEventListener('keydown', updateActivity)
    window.addEventListener('scroll', updateActivity)
    window.addEventListener('click', updateActivity)

    return () => {
      window.removeEventListener('mousemove', updateActivity)
      window.removeEventListener('keydown', updateActivity)
      window.removeEventListener('scroll', updateActivity)
      window.removeEventListener('click', updateActivity)
    }
  }, [])

  // Smart polling interval calculator
  const getPollingInterval = () => {
    if (!isTabVisible) return 30000 // 30s when tab not visible

    const timeSinceActivity = Date.now() - lastActivity

    if (timeSinceActivity < 5000) return 1500   // 1.5s when very active
    if (timeSinceActivity < 30000) return 3000  // 3s when recently active
    return 10000                                 // 10s when idle
  }

  useEffect(() => {
    fetchChats()

    const pollChats = () => {
      const interval = getPollingInterval()
      chatsPollingRef.current = setTimeout(() => {
        fetchChats()
        pollChats() // Re-schedule with new interval
      }, interval)
    }

    pollChats()

    return () => {
      if (chatsPollingRef.current) clearTimeout(chatsPollingRef.current)
    }
  }, [isTabVisible, lastActivity])

  const stopMessagePolling = () => {
    if (messagePollingRef.current) {
      clearTimeout(messagePollingRef.current)
      messagePollingRef.current = null
    }
  }

  const fetchMessages = async (chatId) => {
    try {
      const response = await fetch(POST_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'show_chat', chat_id: chatId }),
      })
      const data = await response.json()
      setCurrentMessages(data)
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('Error fetching messages', e)
      setCurrentMessages([])
    }
  }

  const fetchMessagesUpdate = async (chatId) => {
    try {
      const response = await fetch(POST_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'show_chat', chat_id: chatId }),
      })
      const data = await response.json()
      if (JSON.stringify(data) !== JSON.stringify(currentMessages)) {
        setCurrentMessages(data)
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('Error polling messages', e)
    }
  }

  const startMessagePolling = (chatId) => {
    stopMessagePolling()

    const pollMessages = () => {
      if (chatId) {
        fetchMessagesUpdate(chatId)
        const interval = getPollingInterval()
        messagePollingRef.current = setTimeout(pollMessages, interval)
      }
    }

    pollMessages()
  }

  const selectChat = async (chatId) => {
    setCurrentChatId(chatId)
    setIsActiveChat(true)
    await fetchMessages(chatId)
    startMessagePolling(chatId)
  }

  const showSidebar = () => {
    setIsActiveChat(false)
    stopMessagePolling()
    if (windowWidth <= 774) {
      setCurrentChatId(null)
      setCurrentMessages(null)
    }
  }

  const goBackToSidebar = () => {
    if (activePage === 'chats') {
      showSidebar()
      return
    }
    if (activePage.startsWith('admin')) {
      setActivePage('admin')
      return
    }
    if (activePage === 'crm' || activePage.startsWith('crm-')) {
      setActivePage('crm')
      return
    }
  }

  const toggleChatStatus = async (chatId) => {
    const current = !!chatToggles[chatId]
    const next = !current
    try {
      await setChatStatus(chatId, next)
      const res = await fetch(TOGGLE_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'toggle_chat', chat_id: chatId, enabled: next }),
      })
      if (res.ok) setChatToggles((prev) => ({ ...prev, [chatId]: next }))
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('Error toggling chat', e)
    }
  }

  const sendAgentMessage = async (chatId, message) => {
    if (!message) return
    try {
      const response = await fetch(POST_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, action: 'agent_message', chatId }),
      })
      await response.json()
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('Error sending agent message', e)
    }
  }

  const filteredSortedChatIds = useMemo(() => {
    const ids = Object.keys(chatsData)
    const s = (searchTerm || '').toLowerCase()
    const filtered = ids.filter((id) => {
      const c = chatsData[id]
      const name = (c.user_name || '').toLowerCase()
      return name.includes(s) || id.toLowerCase().includes(s)
    })
    filtered.sort((a, b) => {
      const timeA = new Date(chatsData[a].last_message_time || 0)
      const timeB = new Date(chatsData[b].last_message_time || 0)
      return timeB - timeA
    })
    return filtered
  }, [chatsData, searchTerm])

  const isToggleActive = !!(currentChatId && chatToggles[currentChatId])

  // Track window width for responsive behavior
  const [windowWidth, setWindowWidth] = useState(typeof window !== 'undefined' ? window.innerWidth : 1024)
  useEffect(() => {
    const onResize = () => setWindowWidth(window.innerWidth)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const isDetailActive = useMemo(() => {
    // Chats rely on explicit isActiveChat flag for mobile slide behavior
    if (activePage === 'chats') return false
    if (activePage.startsWith('admin')) return activePage !== 'admin'
    if (activePage === 'crm' || activePage.startsWith('crm-')) return activePage !== 'crm'
    return false
  }, [activePage])

  return (
    <div className="container">
      <div className="topbar">
        <div className="brand-title">WhatsApp Tracker</div>
        <div className="user-pill">
          <div className="user-avatar-pill">{(authUser?.username || authUser?.email || 'U').charAt(0).toUpperCase()}</div>
          <div className="user-meta">
            <div className="user-label">Signed in</div>
            <div className="user-name">{authUser?.username || authUser?.email}</div>
          </div>
          <button className="logout-btn" onClick={() => { localStorage.removeItem('auth_token'); localStorage.removeItem('auth_user'); window.location.reload() }}>Logout</button>
        </div>
      </div>
      <div className={((isActiveChat || isDetailActive) && windowWidth <= 774 ? 'sidebar slide-out' : 'sidebar') + (sidebarCollapsed ? ' collapsed' : '') + ` page-${activePage}`} id="sidebar">
        <div className="sidebar-header">
          <div className="sidebar-header-title">Chats</div>
          {authUser?.role === 'admin' && activePage === 'chats' ? (
            <button
              className="sidebar-shrink-btn"
              title={sidebarCollapsed ? 'Expand' : 'Collapse'}
              onClick={() => setSidebarCollapsed((v) => !v)}
            >
              {sidebarCollapsed ? '⏵' : '⏴'}
            </button>
          ) : null}
        </div>
        {activePage === 'chats' ? (
          <div className="search-container">
            <div className="search-box">
              <input
                type="text"
                className="search-input"
                placeholder="Search chats"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
          </div>
        ) : null}
        {activePage === 'chats' ? (
          <div className="chat-list" id="chatList">
            {filteredSortedChatIds.length === 0 ? (
              <div className="loading">
                <span>{Object.keys(chatsData).length === 0 ? 'No chats available' : 'No results found'}</span>
              </div>
            ) : (
              filteredSortedChatIds.map((chatId) => {
                const chat = chatsData[chatId]
                const userName = chat.user_name || 'User'
                const initial = userName.charAt(0).toUpperCase()
                const displayTime = formatChatTime(chat.last_message_time)
                const unreadCount = chat.unread_count ? parseInt(chat.unread_count) : 0
                const active = currentChatId === chatId
                const onClickItem = () => selectChat(chatId)
                const toggleActive = !!chatToggles[chatId]
                return (
                  <div className={`chat-item${active ? ' active' : ''}`} key={chatId} onClick={onClickItem}>
                    <div className="toggle-container" onClick={(e) => e.stopPropagation()}>
                      <div
                        className={`toggle-switch ${toggleActive ? 'active' : ''}`}
                        onClick={() => toggleChatStatus(chatId)}
                      >
                        <div className="toggle-slider"></div>
                      </div>
                    </div>
                    <div className="chat-avatar">{initial}</div>
                    <div className="chat-info">
                      <div className="chat-info-top">
                        <div className="chat-name">{userName}</div>
                        {unreadCount > 0 ? (
                          <div className="chat-time-unread">{displayTime}</div>
                        ) : (
                          <div className="chat-time">{displayTime}</div>
                        )}
                      </div>
                      <div className="chat-preview">
                        {unreadCount > 0 ? (
                          <span className="unread-badge">{unreadCount} new</span>
                        ) : (
                          'Click to view messages'
                        )}
                      </div>
                    </div>
                  </div>
                )
              })
            )}
          </div>
        ) : (
          <div className="page-side">
            {activePage.startsWith('admin') ? (
              <div className="menu-vertical">
                <button className={`menu-btn${activePage === 'admin-dashboard' ? ' active' : ''}`} title="Admin Dashboard" onClick={() => { setActivePage('admin-dashboard'); setSidebarCollapsed(true) }}>
                  <span className="mini-ico" data-ico="admin" />
                  <span className="menu-label">Dashboard</span>
                </button>
                <button className={`menu-btn${activePage === 'admin-add-user' ? ' active' : ''}`} title="Add User" onClick={() => { setActivePage('admin-add-user'); setSidebarCollapsed(true) }}>
                  <span className="mini-ico" data-ico="crm" />
                  <span className="menu-label">Add User</span>
                </button>
              </div>
            ) : activePage === 'crm' || activePage.startsWith('crm-') ? (
              <div className="menu-vertical">
                <button className={`menu-btn${activePage === 'crm-leads' ? ' active' : ''}`} title="Leads" onClick={() => { setActivePage('crm-leads'); setSidebarCollapsed(true) }}>
                  <span className="mini-ico" data-ico="crm" />
                  <span className="menu-label">Leads</span>
                </button>
                <button className={`menu-btn${activePage === 'crm-reports' ? ' active' : ''}`} title="Reports" onClick={() => { setActivePage('crm-reports'); setSidebarCollapsed(true) }}>
                  <span className="mini-ico" data-ico="crm" />
                  <span className="menu-label">Reports</span>
                </button>
              </div>
            ) : (
              <div className="page-ico" data-ico={activePage === 'crm' ? 'crm' : 'admin'} />
            )}
          </div>
        )}
        {authUser?.role === 'admin' ? (
          <div className="mini-nav">
            <button className={`mini-nav-btn${activePage === 'chats' ? ' active' : ''}`} onClick={() => { setActivePage('chats'); setSidebarCollapsed(false) }} title="Chats">
              <span className="mini-ico" data-ico="chat" />
            </button>
            <button className={`mini-nav-btn${(activePage.startsWith('admin')) ? ' active' : ''}`} onClick={() => { setActivePage('admin'); setSidebarCollapsed(false) }} title="Admin">
              <span className="mini-ico" data-ico="admin" />
            </button>
            <button className={`mini-nav-btn${(activePage === 'crm' || activePage.startsWith('crm-')) ? ' active' : ''}`} onClick={() => { setActivePage('crm'); setSidebarCollapsed(false) }} title="CRM">
              <span className="mini-ico" data-ico="crm" />
            </button>
          </div>
        ) : null}
      </div>

      <div className="chat-area">
        {activePage === 'chats' && currentChatId ? (
          <div className="chat-header" id="chatHeader">
            <button className="back-button" onClick={showSidebar}>←</button>
            <div className="chat-header-avatar">
              {(() => {
                const name = chatsData[currentChatId]?.user_name || 'User'
                return name.charAt(0).toUpperCase()
              })()}
            </div>
            <div className="chat-header-info">
              <div className="chat-header-name">
                {chatsData[currentChatId]?.user_name || 'User'}
                <div className="live-indicator" style={{
                  display: 'inline-block',
                  width: '8px',
                  height: '8px',
                  borderRadius: '50%',
                  backgroundColor: isTabVisible ? '#25d366' : '#8696a0',
                  marginLeft: '8px',
                  animation: isTabVisible ? 'pulse 2s infinite' : 'none'
                }} />
              </div>
            </div>
          </div>
        ) : null}

        <div className="messages-container" id="messagesContainer" style={{ display: activePage === 'chats' ? 'block' : 'none' }}>
          {!currentChatId ? (
            <div className="empty-state">
              <div className="empty-icon">💬</div>
              <div className="empty-text">WhatsApp API Tracker</div>
              <div className="empty-subtext">
                Monitor and track your WhatsApp conversations in real-time.<br />
                Select a chat from the list to view message history.
              </div>
            </div>
          ) : !currentMessages ? (
            <div className="loading">
              <span>Loading messages</span>
              <div className="spinner"></div>
            </div>
          ) : Array.isArray(currentMessages) ? (
            currentMessages.length === 0 ? (
              <div className="empty-state">
                <div className="empty-icon">📭</div>
                <div className="empty-text">No messages yet</div>
              </div>
            ) : (
              currentMessages.map((msg, index) => {
                const hasUser = !!msg.user_message
                const hasBot = !!msg.bot_message
                return (
                  <div key={index}>
                    {hasUser ? (
                      <div className="message user">
                        <div className="message-bubble">
                          <span className="message-text">{formatMessageTextToNodes(msg.user_message)}</span>
                          {(() => {
                            const t = msg.user_timestamp || msg.timestamp || msg.created_at || msg.time
                            const time = formatMessageTime(t)
                            return time ? <span className="message-time">{time}</span> : null
                          })()}
                        </div>
                      </div>
                    ) : null}
                    {hasBot ? (
                      <div className="message bot">
                        <div className="message-bubble">
                          <span className="message-text">{formatMessageTextToNodes(msg.bot_message)}</span>
                          {(() => {
                            const t = msg.bot_timestamp || msg.timestamp || msg.created_at || msg.time
                            const time = formatMessageTime(t)
                            return time ? <span className="message-time">{time}</span> : null
                          })()}
                        </div>
                      </div>
                    ) : null}
                  </div>
                )
              })
            )
          ) : (
            // Object shape with user_message/bot_message
            <div>
              {currentMessages.user_message ? (
                <div className="message user">
                  <div className="message-bubble">
                    <span className="message-text">{formatMessageTextToNodes(currentMessages.user_message)}</span>
                    {(() => {
                      const t = currentMessages.user_timestamp || currentMessages.timestamp || currentMessages.created_at || currentMessages.time
                      const time = formatMessageTime(t)
                      return time ? <span className="message-time">{time}</span> : null
                    })()}
                  </div>
                </div>
              ) : null}
              {currentMessages.bot_message ? (
                <div className="message bot">
                  <div className="message-bubble">
                    <span className="message-text">{formatMessageTextToNodes(currentMessages.bot_message)}</span>
                    {(() => {
                      const t = currentMessages.bot_timestamp || currentMessages.timestamp || currentMessages.created_at || currentMessages.time
                      const time = formatMessageTime(t)
                      return time ? <span className="message-time">{time}</span> : null
                    })()}
                  </div>
                </div>
              ) : null}
            </div>
          )}
        </div>

        <div className="chat-input-container" id="chatInputContainer" style={{ display: currentChatId && activePage === 'chats' ? 'flex' : 'none' }}>
          <input
            type="text"
            id="agentMessageInput"
            placeholder="Type a message..."
            className="chat-input"
            disabled={!isToggleActive}
            onKeyDown={async (e) => {
              if (e.key === 'Enter') {
                const value = e.currentTarget.value.trim()
                if (value) {
                  setCurrentMessages((prev) => {
                    const list = Array.isArray(prev) ? prev.slice() : []
                    list.push({ user_message: value, user_timestamp: new Date().toISOString() })
                    return list
                  })
                  const toSend = value
                  e.currentTarget.value = ''
                  await sendAgentMessage(currentChatId, toSend)
                }
              }
            }}
          />
          <button
            onClick={async () => {
              const input = document.getElementById('agentMessageInput')
              const value = input.value.trim()
              if (!value) return
              setCurrentMessages((prev) => {
                const list = Array.isArray(prev) ? prev.slice() : []
                list.push({ user_message: value, user_timestamp: new Date().toISOString() })
                return list
              })
              input.value = ''
              await sendAgentMessage(currentChatId, value)
            }}
            className="send-button"
            disabled={!isToggleActive}
          >
            Send
          </button>
        </div>

        {activePage === 'admin-dashboard' ? (
          <div className="page-container"><AdminDashboard /></div>
        ) : null}
        {activePage === 'admin-add-user' ? (
          <div className="page-container"><AddUserPage /></div>
        ) : null}
        {activePage === 'crm' ? (
          <div className="page-container"><CrmPage /></div>
        ) : null}
        {activePage === 'crm-leads' ? (
          <div className="page-container"><CrmLeadsPage /></div>
        ) : null}
        {activePage === 'crm-reports' ? (
          <div className="page-container"><CrmReportsPage /></div>
        ) : null}
        {(windowWidth <= 774 && (activePage === 'admin-dashboard' || activePage === 'admin-add-user' || activePage === 'crm-leads' || activePage === 'crm-reports')) ? (
          <div className="chat-header" style={{ position: 'absolute', top: 0, left: 0, right: 0 }}>
            <button className="back-button" onClick={goBackToSidebar}>←</button>
            <div className="chat-header-info">
              <div className="chat-header-name">
                {activePage.startsWith('admin') ? (activePage === 'admin-add-user' ? 'Admin • Add User' : 'Admin • Dashboard') : (activePage === 'crm-leads' ? 'CRM • Leads' : 'CRM • Reports')}
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}

function AdminDashboard() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [email, setEmail] = useState('')
  const [role, setRole] = useState('user')
  const [status, setStatus] = useState('')
  const token = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null
  const can = username && password
  const onSubmit = async (e) => {
    e.preventDefault()
    if (!can) return
    setStatus('')
    try {
      await adminCreateUser(token, { username, password, email, role })
      setStatus('User created')
      setUsername(''); setPassword(''); setEmail(''); setRole('user')
    } catch (err) {
      setStatus(err.message || 'Failed')
    }
  }
  return (
    <form className="admin-form" onSubmit={onSubmit}>
      <div className="admin-title">Admin Dashboard</div>
      {status ? <div className="admin-status">{status}</div> : null}
      <div className="admin-row">
        <input className="admin-input" placeholder="Username" value={username} onChange={(e) => setUsername(e.target.value)} />
      </div>
      <div className="admin-row">
        <input className="admin-input" placeholder="Password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
      </div>
      <div className="admin-row">
        <input className="admin-input" placeholder="Email (optional)" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      </div>
      <div className="admin-row">
        <select className="admin-input" value={role} onChange={(e) => setRole(e.target.value)}>
          <option value="user">User</option>
          <option value="admin">Admin</option>
        </select>
      </div>
      <button className="admin-submit" disabled={!can} type="submit">Create user</button>
    </form>
  )
}

function AddUserPage() {
  const token = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null
  const [users, setUsers] = useState([])
  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState('user')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [showPassword, setShowPassword] = useState(false)

  const loadUsers = async () => {
    setLoading(true)
    setError('')
    try {
      const list = await adminListUsers(token)
      setUsers(list)
    } catch (e) {
      setError(e.message || 'Failed to load users')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { if (token) { loadUsers() } }, [])

  const addUser = async (e) => {
    e.preventDefault()
    if (!username || !password) return
    setLoading(true)
    setError('')
    try {
      await adminCreateUser(token, { username, password, email, role })
      setUsername(''); setPassword(''); setEmail(''); setRole('user')
      await loadUsers()
    } catch (e) {
      setError(e.message || 'Failed to add user')
    } finally {
      setLoading(false)
    }
  }

  const deleteUser = async (id) => {
    setLoading(true)
    setError('')
    try {
      await adminDeleteUser(token, id)
      await loadUsers()
    } catch (e) {
      setError(e.message || 'Failed to delete user')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="users-page">
      <form className="admin-form users-form" onSubmit={addUser}>
        <div className="admin-title">Add User</div>
        {error ? <div className="admin-status">{error}</div> : null}
        <div className="users-form-grid">
          <input className="admin-input" placeholder="Username" value={username} onChange={(e) => setUsername(e.target.value)} />
          <input className="admin-input" placeholder="Email (optional)" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <input className="admin-input" placeholder="Password" type={showPassword ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)} />
            <button type="button" className="table-btn" onClick={() => setShowPassword((v) => !v)} title={showPassword ? 'Hide password' : 'Show password'}>{showPassword ? 'Hide' : 'Show'}</button>
          </div>
          <select className="admin-input" value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="user">User</option>
            <option value="admin">Admin</option>
          </select>
          <button className="admin-submit" type="submit" disabled={!username || !password || loading}>{loading ? 'Adding…' : 'Add'}</button>
        </div>
      </form>

      <div className="users-table-wrap">
        <div style={{ padding: '10px 12px', display: 'flex', justifyContent: 'flex-end' }}>
          <button className="table-btn" onClick={loadUsers} disabled={loading}>{loading ? 'Refreshing…' : 'Refresh'}</button>
        </div>
        <table className="users-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>Username</th>
              <th>Email</th>
              <th>Role</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan="5" style={{ textAlign: 'center', color: '#8696a0' }}>Loading…</td></tr>
            ) : users.length === 0 ? (
              <tr>
                <td colSpan="5" style={{ textAlign: 'center', color: '#8696a0' }}>No users yet</td>
              </tr>
            ) : users.map((u) => (
              <tr key={u.id}>
                <td>{u.id}</td>
                <td>{u.username}</td>
                <td>{u.email || ''}</td>
                <td>{u.role}</td>
                <td>
                  <button className="table-btn danger" onClick={() => deleteUser(u.id)} disabled={loading}>Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function CrmPage() {
  return (
    <div className="crm-empty">
      CRM Page (Coming soon)
    </div>
  )
}

function CrmLeadsPage() {
  return (
    <div className="crm-empty">
      Leads (Coming soon)
    </div>
  )
}

function CrmReportsPage() {
  return (
    <div className="crm-empty">
      Reports (Coming soon)
    </div>
  )
}

export default App
