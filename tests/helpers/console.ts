import { onTestFinished, vi } from 'vitest'

/**
 * For a test that makes the app fail on purpose -- Pluggy answering 500, Resend
 * down -- where the code under test logs the failure with console.error and
 * carries on. Keeps that expected noise out of the test output and hands back
 * what was logged, so the test can assert the failure was actually reported
 * rather than just muted. Restored when the test finishes; any console.error
 * outside such a test still prints, so an unexpected one stays visible.
 */
export function captureConsoleError() {
  const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
  onTestFinished(() => spy.mockRestore())
  return {
    /** The first argument of every console.error call: the log's message. */
    messages: () => spy.mock.calls.map((call) => String(call[0])),
  }
}
