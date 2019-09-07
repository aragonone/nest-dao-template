/* global web3 artifacts */

const deployTemplate = require('@aragon/templates-shared/scripts/deploy-template')

const TEMPLATE_NAME = 'nest-template'
const CONTRACT_NAME = 'NestTemplate'

module.exports = callback => {
  deployTemplate(web3, artifacts, TEMPLATE_NAME, CONTRACT_NAME)
    .then(() => {
      callback()
    })
    .catch(callback)
}
