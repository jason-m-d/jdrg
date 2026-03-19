import { test, expect } from '@playwright/test'

const EMAIL = 'jason@hungry.llc'
const PASSWORD = 'JDRG2026!'

// Helper: login and return authenticated page
async function login(page: any) {
  await page.goto('/login')
  await page.fill('input[type="email"]', EMAIL)
  await page.fill('input[type="password"]', PASSWORD)
  await page.click('button[type="submit"]')
  await page.waitForURL('**/dashboard', { timeout: 10000 })
}

test.describe('Auth', () => {
  test('unauthenticated user sees login page', async ({ page }) => {
    await page.goto('/login')
    await expect(page.locator('text=Crosby')).toBeVisible()
    await expect(page.locator('input[type="email"]')).toBeVisible()
    await expect(page.locator('input[type="password"]')).toBeVisible()
  })

  test('login with valid credentials redirects to dashboard', async ({ page }) => {
    await login(page)
    await expect(page).toHaveURL(/dashboard/)
  })

  test('login with wrong password shows error', async ({ page }) => {
    await page.goto('/login')
    await page.fill('input[type="email"]', EMAIL)
    await page.fill('input[type="password"]', 'wrongpassword')
    await page.click('button[type="submit"]')
    await expect(page.locator('text=Invalid login credentials')).toBeVisible({ timeout: 5000 })
  })
})

test.describe('Dashboard', () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  test('dashboard loads with sales digest', async ({ page }) => {
    await expect(page.locator('text=Sales Digest')).toBeVisible()
    await expect(page.locator('text=Wingstop')).toBeVisible()
    await expect(page.locator("text=Mr. Pickle's")).toBeVisible()
  })

  test('dashboard shows action items section', async ({ page }) => {
    await expect(page.getByRole('main').getByText('Action Items')).toBeVisible()
  })

  test('quick capture creates an action item', async ({ page }) => {
    const taskText = `Test task ${Date.now()}`
    await page.fill('input[placeholder*="Quick capture"]', taskText)
    await page.click('button:has-text("Capture")')
    // Input should clear after submit
    await expect(page.locator('input[placeholder*="Quick capture"]')).toHaveValue('')
  })

  test('recent documents section visible', async ({ page }) => {
    await expect(page.locator('text=Recent Documents')).toBeVisible()
  })

  test('recent conversations section visible', async ({ page }) => {
    await expect(page.locator('text=Recent Conversations')).toBeVisible()
  })
})

test.describe('Sidebar Navigation', () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  test('sidebar shows all nav links', async ({ page }) => {
    await expect(page.locator('a:has-text("Dashboard")')).toBeVisible()
    await expect(page.locator('a:has-text("Chat")')).toBeVisible()
    await expect(page.locator('a:has-text("Documents")')).toBeVisible()
    await expect(page.locator('a:has-text("Projects")')).toBeVisible()
    await expect(page.locator('a:has-text("Action Items")')).toBeVisible()
    await expect(page.locator('a:has-text("Settings")')).toBeVisible()
  })

  test('sidebar shows seeded projects', async ({ page }) => {
    await expect(page.locator('text=Operations')).toBeVisible()
    await expect(page.locator('text=Finance')).toBeVisible()
    await expect(page.locator('text=HR')).toBeVisible()
  })

  test('navigate to chat', async ({ page }) => {
    await page.click('a:has-text("Chat")')
    await expect(page).toHaveURL(/chat/)
  })

  test('navigate to documents', async ({ page }) => {
    await page.click('a:has-text("Documents")')
    await expect(page).toHaveURL(/documents/)
  })

  test('navigate to projects', async ({ page }) => {
    await page.click('a:has-text("Projects")')
    await expect(page).toHaveURL(/projects/)
  })

  test('navigate to action items', async ({ page }) => {
    await page.click('a:has-text("Action Items")')
    await expect(page).toHaveURL(/action-items/)
  })

  test('navigate to settings', async ({ page }) => {
    await page.click('a:has-text("Settings")')
    await expect(page).toHaveURL(/settings/)
  })
})

test.describe('Chat', () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
    await page.click('a:has-text("Chat")')
    await page.waitForURL('**/chat')
  })

  test('chat page loads with empty state', async ({ page }) => {
    await expect(page.locator('text=What are you working on?')).toBeVisible()
  })

  test('project selector works', async ({ page }) => {
    await page.click('button:has-text("No project")')
    await expect(page.locator('[role="option"]:has-text("Operations")')).toBeVisible()
    await expect(page.locator('[role="option"]:has-text("Finance")')).toBeVisible()
  })

  test('can send a message and get streaming response', async ({ page }) => {
    await page.fill('textarea', 'What stores do we operate?')
    await page.click('button[type="submit"]')

    // User message should appear in the chat area
    await expect(page.getByRole('main').getByText('What stores do we operate?')).toBeVisible()

    // AI should start responding (wait for the thinking indicator or response text)
    await expect(page.locator('text=Thinking...')).toBeVisible({ timeout: 5000 }).catch(() => {
      // Might have already started streaming
    })

    // Wait for response to complete (look for AI avatar)
    await expect(page.locator('div:has-text("AI")').first()).toBeVisible({ timeout: 30000 })

    // URL should update to include conversation ID
    await page.waitForURL(/chat\//, { timeout: 15000 })
  })
})

test.describe('Documents', () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
    await page.click('a:has-text("Documents")')
    await page.waitForURL('**/documents')
  })

  test('documents page loads', async ({ page }) => {
    await expect(page.locator('h1:has-text("Documents")')).toBeVisible()
    await expect(page.locator('text=Upload')).toBeVisible()
    await expect(page.locator('text=Create')).toBeVisible()
  })

  test('search input exists', async ({ page }) => {
    await expect(page.locator('input[placeholder*="Search"]')).toBeVisible()
  })

  test('create document page loads', async ({ page }) => {
    await page.click('button:has-text("Create")')
    await page.waitForURL('**/documents/new')
    await expect(page.locator('h1:has-text("New Document")')).toBeVisible()
    await expect(page.locator('input[placeholder="Document title"]')).toBeVisible()
  })

  test('can upload a file', async ({ page }) => {
    // Create a temp text file to upload
    const buffer = Buffer.from('This is a test document for upload.')
    await page.locator('input[type="file"]').setInputFiles({
      name: 'test-upload.txt',
      mimeType: 'text/plain',
      buffer,
    })
    // Wait for upload to complete and doc to appear
    await expect(page.locator('text=test-upload')).toBeVisible({ timeout: 10000 })
  })

  test('can create a text document', async ({ page }) => {
    await page.click('button:has-text("Create")')
    await page.waitForURL('**/documents/new')

    await page.fill('input[placeholder="Document title"]', 'Test Document')
    await page.fill('textarea[placeholder="Start writing..."]', 'This is test content for the document.')
    await page.click('button:has-text("Create Document")')

    // Should redirect to the document editor
    await page.waitForURL(/documents\/[a-f0-9-]+/, { timeout: 10000 })
  })
})

test.describe('Projects', () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
    await page.click('a:has-text("Projects")')
    await page.waitForURL('**/projects')
  })

  test('projects page shows seeded projects', async ({ page }) => {
    await expect(page.locator('h1:has-text("Projects")')).toBeVisible()
    await expect(page.locator('text=Operations')).toBeVisible()
    await expect(page.locator('text=Finance')).toBeVisible()
    await expect(page.locator('text=HR')).toBeVisible()
    await expect(page.locator('text=Marketing')).toBeVisible()
    await expect(page.locator('text=Legal')).toBeVisible()
  })

  test('can open new project dialog', async ({ page }) => {
    await page.click('button:has-text("New Project")')
    await expect(page.locator('text=New Project').nth(1)).toBeVisible()
    await expect(page.locator('input[placeholder="Project name"]')).toBeVisible()
  })

  test('can create and delete a project', async ({ page }) => {
    await page.click('button:has-text("New Project")')
    const projectName = `TestProj-${Date.now()}`
    await page.fill('input[placeholder="Project name"]', projectName)
    await page.fill('input[placeholder="Brief description"]', 'A test project')
    await page.click('button:has-text("Create Project")')

    // Dialog should close and project should appear
    await expect(page.locator(`div[data-slot="card-title"]:has-text("${projectName}")`)).toBeVisible({ timeout: 5000 })

    // Delete it
    page.on('dialog', dialog => dialog.accept())
    const card = page.locator(`div[data-slot="card-title"]:has-text("${projectName}")`).locator('..')
    await card.locator('button').click()
    await expect(page.locator(`text=${projectName}`)).not.toBeVisible({ timeout: 5000 })
  })

  test('can click into a project', async ({ page }) => {
    await page.click('text=Operations')
    await page.waitForURL(/projects\/[a-f0-9-]+/)
    await expect(page.locator('h1:has-text("Operations")')).toBeVisible()
  })
})

test.describe('Action Items', () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
    await page.click('a:has-text("Action Items")')
    await page.waitForURL('**/action-items')
  })

  test('action items page loads with tabs', async ({ page }) => {
    await expect(page.locator('h1:has-text("Action Items")')).toBeVisible()
    await expect(page.locator('button:has-text("Pending")')).toBeVisible()
    await expect(page.locator('button:has-text("Approved")')).toBeVisible()
    await expect(page.locator('button:has-text("Completed")')).toBeVisible()
    await expect(page.locator('button:has-text("Dismissed")')).toBeVisible()
  })

  test('can switch between tabs', async ({ page }) => {
    await page.click('button:has-text("Approved")')
    await page.click('button:has-text("Completed")')
    await page.click('button:has-text("Dismissed")')
    await page.click('button:has-text("Pending")')
  })
})

test.describe('Settings', () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
    await page.click('a:has-text("Settings")')
  })

  test('settings redirects to memory page', async ({ page }) => {
    await page.waitForURL('**/settings/memory')
    await expect(page.locator('h1:has-text("Memory")')).toBeVisible()
  })

  test('memory page shows seeded memories', async ({ page }) => {
    await page.waitForURL('**/settings/memory')
    await expect(page.locator('text=Jason DeMayo is CEO')).toBeVisible({ timeout: 5000 })
  })

  test('can navigate to email settings', async ({ page }) => {
    await page.waitForURL('**/settings/memory')
    await page.click('a:has-text("Email")')
    await page.waitForURL('**/settings/email')
    await expect(page.locator('h1:has-text("Email Integration")')).toBeVisible()
  })

  test('can navigate to account settings', async ({ page }) => {
    await page.waitForURL('**/settings/memory')
    await page.click('a:has-text("Account")')
    await page.waitForURL('**/settings/account')
    await expect(page.locator('h1:has-text("Account")')).toBeVisible()
    await expect(page.locator('text=jason@hungry.llc')).toBeVisible()
  })

  test('can add a new memory', async ({ page }) => {
    await page.waitForURL('**/settings/memory')
    const memoryText = `Test memory ${Date.now()}`
    await page.fill('textarea[placeholder="Add a new memory..."]', memoryText)
    await page.click('button:has-text("Add Memory")')
    await expect(page.locator(`text=${memoryText}`)).toBeVisible({ timeout: 5000 })
  })
})

test.describe('Sign Out', () => {
  test('can sign out', async ({ page }) => {
    await login(page)
    await page.click('button:has-text("Sign Out")')
    await page.waitForURL('**/login', { timeout: 10000 })
    await expect(page.locator('text=Crosby')).toBeVisible()
  })
})
