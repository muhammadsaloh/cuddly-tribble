import crypto from 'node:crypto'
import { expect, test, type BrowserContext } from '@playwright/test'

const apiUrl = process.env.E2E_API_URL || 'http://localhost:3000'
const token = process.env.TELEGRAM_BOT_TOKEN

async function signIn(context: BrowserContext, telegramId: number, firstName: string) {
  if (!token) throw new Error('TELEGRAM_BOT_TOKEN is required for end-to-end tests')
  const auth_date = Math.floor(Date.now() / 1000)
  const check = `auth_date=${auth_date}\nfirst_name=${firstName}\nid=${telegramId}`
  const hash = crypto
    .createHmac('sha256', crypto.createHash('sha256').update(token).digest())
    .update(check)
    .digest('hex')
  const response = await context.request.post(`${apiUrl}/auth/telegram`, {
    data: { id: telegramId, first_name: firstName, auth_date, hash },
    headers: { Origin: process.env.E2E_WEB_URL || 'http://localhost:5173' },
  })
  expect(response.ok()).toBeTruthy()
}

test('two colleagues discover, accept, message, complete, and review an exchange', async ({ browser }) => {
  const alice = await browser.newContext()
  const bob = await browser.newContext()
  const unique = Date.now() % 1000000000
  const aliceName = `Alice ${unique}`
  const bobName = `Bob ${unique}`
  await signIn(alice, 800000000 + unique, aliceName)
  await signIn(bob, 1800000000 + unique, bobName)
  const a = await alice.newPage()
  const b = await bob.newPage()
  await a.goto('/post')
  await a.getByLabel('Amount').fill('400')
  await a.getByPlaceholder('UZS per 1 USD').fill('12750')
  await a.getByText('Bank transfer', { exact: true }).click()
  await a.getByRole('button', { name: 'Post request' }).click()
  await expect(a.getByRole('heading', { name: 'My requests' })).toBeVisible()
  await b.goto('/post')
  await b.getByRole('button', { name: /I need UZS/ }).click()
  await b.getByLabel('Amount').fill('6375000')
  await b.getByPlaceholder('UZS per 1 USD').fill('12750')
  await b.getByText('Bank transfer', { exact: true }).click()
  await b.getByRole('button', { name: 'Post request' }).click()
  await a.goto('/matches')
  await b.goto('/matches')
  const aliceMatch = a.locator('article.match-item').filter({ hasText: bobName })
  const bobMatch = b.locator('article.match-item').filter({ hasText: aliceName })
  await expect(aliceMatch).toContainText('$400')
  await aliceMatch.getByRole('button', { name: 'Accept match' }).click()
  await bobMatch.getByRole('button', { name: 'Accept match' }).click()
  await a.reload()
  await a.locator('article.match-item').filter({ hasText: bobName }).getByRole('button', { name: 'Message' }).click()
  await a.getByPlaceholder('Type a message...').fill('Office works for me.')
  await a.getByRole('button', { name: 'Send message' }).click()
  await b.goto('/messages')
  await expect(b.getByText('Office works for me.')).toBeVisible()
  await a.goto('/matches')
  await b.goto('/matches')
  await a
    .locator('article.match-item')
    .filter({ hasText: bobName })
    .getByRole('button', { name: 'Mark completed' })
    .click()
  await b
    .locator('article.match-item')
    .filter({ hasText: aliceName })
    .getByRole('button', { name: 'Mark completed' })
    .click()
  await a.reload()
  await a.locator('article.match-item').filter({ hasText: bobName }).getByRole('button', { name: 'Review' }).click()
  await expect(a.getByText('Review submitted. Thank you.')).toBeVisible()
  await alice.close()
  await bob.close()
})
