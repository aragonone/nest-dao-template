/* global web3 artifacts */

const { APPS } = require('@aragon/templates-shared/helpers/apps')
const deployTemplate = require('@aragon/templates-shared/scripts/deploy-template')

const TEMPLATE_NAME = 'nest-template'
const CONTRACT_NAME = 'NestTemplate'

const apps = [
  ...APPS,
  { name: 'approvals', contractName: 'Approvals' }
]

module.exports = callback => {
  deployTemplate(web3, artifacts, TEMPLATE_NAME, CONTRACT_NAME, apps)
    .then(() => {
      callback()
    })
    .catch(callback)
}
