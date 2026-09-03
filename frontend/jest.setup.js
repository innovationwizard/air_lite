// Learn more: https://github.com/testing-library/jest-dom
import '@testing-library/jest-dom'

// Mock Next.js router
jest.mock('next/navigation', () => ({
  useRouter() {
    return {
      push: jest.fn(),
      replace: jest.fn(),
      prefetch: jest.fn(),
      back: jest.fn(),
      pathname: '/',
      query: {},
      asPath: '/',
    }
  },
  usePathname() {
    return '/'
  },
  useSearchParams() {
    return new URLSearchParams()
  },
}))

// Mock environment variables
process.env.NEXT_PUBLIC_API_BASE_URL = 'http://localhost:3001/v1'
// Needed since 2026-09-04: VivoClient calls useUserRole() (createBrowserClient
// throws synchronously without these) to gate the "Gestionar grupos" button.
// Dummy values — no test exercises real Supabase auth, and callers already
// handle a null user (getUser() resolves against whatever `global.fetch` is
// mocked to return in each test) by rendering with the button hidden.
process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://localhost:54321'
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'test-anon-key'


// jsdom does not expose TextEncoder/TextDecoder, but every real browser does.
// Polyfilled from Node so tests exercise the same code path the browser runs
// (the xlsx writer encodes UTF-8 to build the ZIP).
const { TextEncoder, TextDecoder } = require('util')
if (typeof global.TextEncoder === 'undefined') global.TextEncoder = TextEncoder
if (typeof global.TextDecoder === 'undefined') global.TextDecoder = TextDecoder
