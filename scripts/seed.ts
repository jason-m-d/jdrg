import { config } from 'dotenv'
config({ path: '.env.local' })

import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
)

async function main() {
  console.log('\n=== J.DRG Seed ===\n')

  // Create user
  console.log('Creating admin user...')
  const { data, error } = await supabase.auth.admin.createUser({
    email: 'jason@hungry.llc',
    password: 'JDRG2026!',
    email_confirm: true,
  })
  if (error) {
    if (error.message.includes('already been registered')) {
      console.log('  User already exists, skipping.')
    } else {
      console.error('  Error:', error.message)
    }
  } else {
    console.log(`  Created: ${data.user?.email}`)
  }

  // Seed projects
  console.log('\nSeeding projects...')
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
      console.log(`  ${error.message.includes('duplicate') ? 'Exists' : 'Error'}: ${project.name}`)
    } else {
      console.log(`  Created: ${project.name}`)
    }
  }

  // Seed memories
  console.log('\nSeeding memories...')
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
      console.log(`  [${memory.category}] ${memory.content.slice(0, 60)}...`)
    }
  }

  console.log('\n=== Done! ===\n')
  process.exit(0)
}

main().catch(console.error)
