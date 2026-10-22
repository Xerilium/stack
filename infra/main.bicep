// @req FR:deploy-docs/infra.swa @req FR:deploy-docs/infra.settings @req FR:deploy-docs/infra.params @req FR:deploy-docs/infra.lint (checked by tests/deploy/deploy.test.ts; infra/main.parameters.json is the parameter file)
// Stack hosting: Azure Static Web Apps (Free) with managed Functions.
// Build-only: nothing here is deployed by agents. See docs/runbook.md.
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
  }
}

output hostname string = site.properties.defaultHostname
