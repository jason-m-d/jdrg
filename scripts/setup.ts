import { config } from 'dotenv'
config({ path: '.env.local' })

import { createClient } from '@supabase/supabase-js'
import * as readline from 'readline'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

if (!supabaseUrl || !serviceRoleKey) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
})

function ask(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close()
      resolve(answer.trim())
    })
  })
}

async function main() {
  console.log('\n=== J.DRG Setup ===\n')

  console.log('STEP 1: Run scripts/setup.sql in the Supabase SQL Editor first.')
  console.log('        Go to: https://supabase.com/dashboard/project/wzhdyfprmgalyvodwrxf/sql/new')
  console.log('        Paste the contents of scripts/setup.sql and run it.\n')

  const ready = await ask('Have you run the SQL? (y/n): ')
  if (ready.toLowerCase() !== 'y') {
    console.log('Please run the SQL first, then re-run this script.')
    process.exit(0)
  }

  // Create user
  console.log('\nSTEP 2: Create admin user')
  const email = await ask('Email: ')
  const password = await ask('Password: ')

  if (email && password) {
    const { data, error } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    })
    if (error) {
      console.error('Error creating user:', error.message)
    } else {
      console.log(`User created: ${data.user?.email}`)
    }
  }

  // Seed projects
  console.log('\nSTEP 3: Seeding default projects...')
  const projects = [
    { name: 'Operations', description: 'Restaurant operations, staffing, daily management', color: '#3B82F6' },
    { name: 'Finance', description: 'P&L, budgets, accounting, taxes', color: '#10B981' },
    { name: 'HR', description: 'Hiring, payroll, compliance, training', color: '#8B5CF6' },
    { name: 'Marketing', description: 'Campaigns, local marketing, brand compliance', color: '#F59E0B' },
    { name: 'Legal', description: 'Leases, contracts, franchise agreements', color: '#6B7280' },
  ]

  for (const project of projects) {
    const { error } = await supabase.from('projects').insert(project)
    if (error) {
      if (error.message.includes('duplicate')) {
        console.log(`  Exists: ${project.name}`)
      } else {
        console.error(`  Error: ${project.name} - ${error.message}`)
      }
    } else {
      console.log(`  Created: ${project.name}`)
    }
  }

  // Seed memories
  console.log('\nSTEP 4: Seeding starter memories...')
  const memories = [
    { content: 'Jason DeMayo is CEO of DeMayo Restaurant Group (DRG) and Hungry Hospitality Group (HHG)', category: 'fact' },
    { content: 'DRG operates 8 Wingstop franchise locations in California: 326 (Coleman, San Jose), 451 (Hollenbeck, Sunnyvale), 895 (McKee, San Jose), 1870 (Showers, Mountain View), 2067 (Aborn, San Jose), 2428 (Winchester, San Jose), 2262 (Stevens Creek, San Jose), 2289 (Prospect, Saratoga)', category: 'fact' },
    { content: "HHG operates 2 Mr. Pickle's franchise locations: 405 (Blackstone, Fresno) and 1008 (Sepulveda, Van Nuys)", category: 'fact' },
    { content: 'DRG ownership: Jason 30% / Woody 70% (passive). HHG ownership: Jason 25% / Eli 25% / Woody 50% (passive)', category: 'fact' },
    { content: 'Key contacts - Roger (DM, DRG): roger@demayorestaurantgroup.com, Jenny (Admin): admin@demayorestaurantgroup.com, Eli (HHG ops): eli@hungry.llc, Kristal (bookkeeper): kristal@raymerbiz.com, Liz (HR/payroll): liz@raymerbiz.com, Argin (CPA): argin@theaccountancy.com, Tony (wealth mgr): Tony.Blagrove@travekawealth.com', category: 'context' },
    { content: 'Jason prefers direct, casual communication. No fluff, no em dashes. Use bullets and clean structure.', category: 'preference' },
  ]

  for (const memory of memories) {
    const { error } = await supabase.from('memories').insert(memory)
    if (error) {
      console.error(`  Error: ${error.message}`)
    } else {
      console.log(`  Seeded: [${memory.category}] ${memory.content.slice(0, 60)}...`)
    }
  }

  console.log('\n=== Setup complete! Run `npm run dev` to start. ===\n')
  process.exit(0)
}

main().catch((err) => {
  console.error('Setup failed:', err)
  process.exit(1)
})
