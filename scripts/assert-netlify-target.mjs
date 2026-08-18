import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const EXPECTED_SITE_ID = '7b9253fa-7b7b-4a7d-96ba-bf1757a225c5'
const EXPECTED_HOSTNAME = 'contotron.netlify.app'

function fail(message) {
  console.error(`\nDEPLOY BLOCCATO: ${message}`)
  console.error(`Destinazione autorizzata: https://${EXPECTED_HOSTNAME} (${EXPECTED_SITE_ID})\n`)
  process.exit(1)
}

function assertSiteId(siteId, source) {
  if (!siteId) {
    fail(`Site ID non disponibile da ${source}.`)
  }

  if (siteId !== EXPECTED_SITE_ID) {
    fail(`il Site ID fornito da ${source} e ${siteId}, non quello di Contotron.`)
  }
}

function assertProductionUrl(url, source) {
  if (!url) return

  let hostname
  try {
    hostname = new URL(url).hostname.toLowerCase()
  } catch {
    fail(`URL Netlify non valido fornito da ${source}: ${url}`)
  }

  if (hostname !== EXPECTED_HOSTNAME) {
    fail(`il dominio fornito da ${source} e ${hostname}, non ${EXPECTED_HOSTNAME}.`)
  }
}

if (process.argv.includes('--local')) {
  const statePath = resolve('.netlify', 'state.json')
  let state

  try {
    state = JSON.parse(readFileSync(statePath, 'utf8'))
  } catch {
    fail('progetto locale non collegato a Netlify o configurazione .netlify/state.json non leggibile.')
  }

  assertSiteId(state.siteId, '.netlify/state.json')
} else if (process.argv.includes('--netlify-build')) {
  assertSiteId(process.env.SITE_ID ?? process.env.NETLIFY_SITE_ID, 'ambiente di build Netlify')
  assertProductionUrl(process.env.URL, 'variabile URL di Netlify')
} else {
  fail('modalita di verifica non specificata.')
}

console.log(`Destinazione Netlify verificata: https://${EXPECTED_HOSTNAME}`)
