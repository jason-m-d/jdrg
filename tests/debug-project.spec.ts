import { test, expect } from '@playwright/test'

const EMAIL = 'jason@hungry.llc'
const PASSWORD = 'JDRG2026!'

async function login(page: any) {
  await page.goto('/login')
  await page.fill('input[type="email"]', EMAIL)
  await page.fill('input[type="password"]', PASSWORD)
  await page.click('button[type="submit"]')
  await page.waitForURL('**/dashboard', { timeout: 10000 })
}

test('navigate to Marketing project and capture errors', async ({ page }) => {
  const consoleErrors: string[] = []
  const networkErrors: string[] = []

  page.on('console', (msg: any) => {
    if (msg.type() === 'error') {
      consoleErrors.push(msg.text())
    }
  })

  page.on('pageerror', (err: any) => {
    consoleErrors.push(`PAGE ERROR: ${err.message}`)
  })

  page.on('response', (response: any) => {
    if (response.status() >= 400) {
      networkErrors.push(`${response.status()} ${response.url()}`)
    }
  })

  await login(page)

  // Go to projects page
  await page.click('a:has-text("Projects")')
  await page.waitForURL('**/projects', { timeout: 10000 })
  await expect(page.locator('text=Marketing')).toBeVisible()

  // Click Marketing project
  await page.click('text=Marketing')
  await page.waitForTimeout(3000)

  // Log what we found
  console.log('=== CURRENT URL ===')
  console.log(page.url())

  console.log('=== CONSOLE ERRORS ===')
  for (const err of consoleErrors) {
    console.log(err)
  }

  console.log('=== NETWORK ERRORS ===')
  for (const err of networkErrors) {
    console.log(err)
  }

  // Check if we actually navigated to a project page
  const url = page.url()
  console.log('=== PAGE CONTENT ===')
  const body = await page.locator('body').textContent()
  console.log(body?.slice(0, 500))

  // This should pass if the page loaded correctly
  expect(url).toMatch(/projects\/[a-f0-9-]+/)
})
