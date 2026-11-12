// @req FR:deploy-docs/infra.swa @req FR:deploy-docs/infra.settings @req FR:deploy-docs/infra.params @req FR:deploy-docs/infra.lint (checked by tests/deploy/deploy.test.ts; infra/main.parameters.json is the parameter file)
// Stack hosting: Azure Static Web Apps (Free) with managed Functions.
// Build-only: nothing here is deployed by agents. See docs/setup-live.md and docs/runbook.md.
// @req FR:deploy-stack-xerilium-com/branch.default
targetScope = 'resourceGroup'

@description('Static Web App name.')
param name string = 'stack-app'

@description('Region. Static Web Apps are only available in a few regions.')
@allowed(['westus2', 'centralus', 'eastus2', 'westeurope', 'eastasia'])
param location string = 'westus2'

@description('Comma-separated owner allow-list, provider:userId (STACK_OWNERS).')
@secure()
param owners string

@description('Secret mixed into token hashes (STACK_TOKEN_PEPPER).')
@secure()
param tokenPepper string

@description('https URL of the private task repo, no credentials (STACK_REPO_URL).')
param repoUrl string

@description('Branch the app reads and commits to (STACK_REPO_BRANCH). Live data stays off main.')
param repoBranch string = 'stack/live'

@description('Custom domain, for example stack.xerilium.com. Empty adds none. Its CNAME must point at the default hostname first.')
param customDomain string = ''

@description('Credential the Function uses to read and write the private task repo (STACK_REPO_TOKEN).')
@secure()
param repoToken string

resource site 'Microsoft.Web/staticSites@2023-12-01' = {
  name: name
  location: location
  sku: {
    name: 'Free'
    tier: 'Free'
  }
  properties: {}
}

resource appSettings 'Microsoft.Web/staticSites/config@2023-12-01' = {
  parent: site
  name: 'appsettings'
  properties: {
    STACK_OWNERS: owners
    STACK_TOKEN_PEPPER: tokenPepper
    STACK_REPO_TOKEN: repoToken
    STACK_REPO_URL: repoUrl
    STACK_REPO_BRANCH: repoBranch
  }
}

// @req FR:deploy-stack-xerilium-com/domain.bicep Free managed certificate; validated by the CNAME (cname-delegation).
resource domain 'Microsoft.Web/staticSites/customDomains@2023-12-01' = if (!empty(customDomain)) {
  parent: site
  name: empty(customDomain) ? 'none' : customDomain
  properties: {
    validationMethod: 'cname-delegation'
  }
}

output hostname string = site.properties.defaultHostname
