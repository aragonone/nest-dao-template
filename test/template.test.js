/* global contract artifacts web3 assert */

const assertRevert = require('@aragon/templates-shared/helpers/assertRevert')(web3)

const { hash: namehash } = require('eth-ens-namehash')
const { APP_IDS } = require('@aragon/templates-shared/helpers/apps')
const { randomId } = require('@aragon/templates-shared/helpers/aragonId')
const { getEventArgument } = require('@aragon/test-helpers/events')
const { deployedAddresses } = require('@aragon/templates-shared/lib/arapp-file')(web3)
const { getInstalledApps, getInstalledAppsById } = require('@aragon/templates-shared/helpers/events')(artifacts)
const { assertRole, assertMissingRole, assertRoleNotGranted } = require('@aragon/templates-shared/helpers/assertRole')(web3)

const NestTemplate = artifacts.require('NestTemplate')

const ENS = artifacts.require('ENS')
const ACL = artifacts.require('ACL')
const Kernel = artifacts.require('Kernel')
const Vault = artifacts.require('Vault')
const Voting = artifacts.require('Voting')
const Finance = artifacts.require('Finance')
const TokenManager = artifacts.require('TokenManager')
const Approvals = artifacts.require('Approvals')
const MiniMeToken = artifacts.require('MiniMeToken')
const PublicResolver = artifacts.require('PublicResolver')
const EVMScriptRegistry = artifacts.require('EVMScriptRegistry')

const ONE_DAY = 60 * 60 * 24
const ONE_MONTH = 30 * ONE_DAY
const ANY_ADDRESS = '0xffffffffffffffffffffffffffffffffffffffff'
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

contract('Nest', ([owner, member1, member2, aaAccount]) => {
  let daoID, template, dao, acl, ens
  let voting, tokenManager, token, finance, vault, approvals
  let approvalsNameHash

  const MEMBERS = [member1, member2]
  const TOKEN_NAME = 'Member Token'
  const TOKEN_SYMBOL = 'Member'
  const AA_ACCOUNT = { address: aaAccount }

  const SUPPORT_REQUIRED = 66e16
  const VOTE_DURATION = 15 * ONE_DAY
  const MIN_ACCEPTANCE_QUORUM = 50e16
  const VOTING_SETTINGS = [SUPPORT_REQUIRED, MIN_ACCEPTANCE_QUORUM, VOTE_DURATION]

  const FINANCE_PERIOD = ONE_MONTH

  before('fetch template and ENS', async () => {
    const { registry, address } = await deployedAddresses()
    ens = ENS.at(registry)
    template = NestTemplate.at(address)
  })

  before('prepare approvals app namehash', async () => {
    approvalsNameHash = namehash('approvals.aragonpm.eth')
  })

  const loadDAO = async (tokenReceipt, instanceReceipt) => {
    dao = Kernel.at(getEventArgument(instanceReceipt, 'DeployDao', 'dao'))
    token = MiniMeToken.at(getEventArgument(tokenReceipt, 'DeployToken', 'token'))
    acl = ACL.at(await dao.acl())

    const installedApps = getInstalledAppsById(instanceReceipt)
    installedApps.approvals = getInstalledApps(instanceReceipt, approvalsNameHash)

    assert.equal(dao.address, getEventArgument(instanceReceipt, 'SetupDao', 'dao'), 'should have emitted a SetupDao event')

    assert.equal(installedApps.voting.length, 1, 'should have installed 1 voting app')
    voting = Voting.at(installedApps.voting[0])

    assert.equal(installedApps.finance.length, 1, 'should have installed 1 finance app')
    finance = Finance.at(installedApps.finance[0])

    assert.equal(installedApps['token-manager'].length, 1, 'should have installed 1 token manager app')
    tokenManager = TokenManager.at(installedApps['token-manager'][0])

    assert.equal(installedApps.vault.length, 1, 'should have installed 1 vault app')
    vault = Vault.at(installedApps.vault[0])

    assert.equal(installedApps.approvals.length, 1, 'should have installed 1 approvals app')
    approvals = Approvals.at(installedApps.approvals[0])
  }

  const itSetupsDAOCorrectly = () => {
    it('registers a new DAO on ENS', async () => {
      const aragonIdNameHash = namehash(`${daoID}.aragonid.eth`)
      const resolvedAddress = await PublicResolver.at(await ens.resolver(aragonIdNameHash)).addr(aragonIdNameHash)
      assert.equal(resolvedAddress, dao.address, 'aragonId ENS name does not match')
    })

    it('creates a new token', async () => {
      assert.equal(await token.name(), TOKEN_NAME)
      assert.equal(await token.symbol(), TOKEN_SYMBOL)
      assert.equal(await token.transfersEnabled(), false)
      assert.equal((await token.decimals()).toString(), 0)
    })

    it('mints requested amounts for the members', async () => {
      assert.equal((await token.totalSupply()).toString(), MEMBERS.length)
      for (const holder of MEMBERS) assert.equal((await token.balanceOf(holder)).toString(), 1)
    })

    it('should have voting app correctly setup', async () => {
      assert.isTrue(await voting.hasInitialized(), 'voting not initialized')
      assert.equal((await voting.supportRequiredPct()).toString(), SUPPORT_REQUIRED)
      assert.equal((await voting.minAcceptQuorumPct()).toString(), MIN_ACCEPTANCE_QUORUM)
      assert.equal((await voting.voteTime()).toString(), VOTE_DURATION)

      await assertRole(acl, voting, AA_ACCOUNT, 'CREATE_VOTES_ROLE', tokenManager)
      await assertRole(acl, voting, AA_ACCOUNT, 'MODIFY_QUORUM_ROLE', voting)
      await assertRole(acl, voting, AA_ACCOUNT, 'MODIFY_SUPPORT_ROLE', voting)
    })

    it('should have token manager app correctly setup', async () => {
      assert.isTrue(await tokenManager.hasInitialized(), 'token manager not initialized')
      assert.equal(await tokenManager.token(), token.address)

      await assertRole(acl, tokenManager, AA_ACCOUNT, 'MINT_ROLE')
      await assertRole(acl, tokenManager, AA_ACCOUNT, 'BURN_ROLE')
      await assertRole(acl, tokenManager, AA_ACCOUNT, 'MINT_ROLE', voting)
      await assertRole(acl, tokenManager, AA_ACCOUNT, 'BURN_ROLE', voting)

      await assertMissingRole(acl, tokenManager, 'ISSUE_ROLE')
      await assertMissingRole(acl, tokenManager, 'ASSIGN_ROLE')
      await assertMissingRole(acl, tokenManager, 'REVOKE_VESTINGS_ROLE')
    })

    it('should have finance app correctly setup', async () => {
      assert.isTrue(await finance.hasInitialized(), 'finance not initialized')

      assert.equal((await finance.getPeriodDuration()).toString(), FINANCE_PERIOD, 'finance period should be 30 days')

      await assertRole(acl, finance, AA_ACCOUNT, 'CREATE_PAYMENTS_ROLE', voting)
      await assertRole(acl, finance, AA_ACCOUNT, 'EXECUTE_PAYMENTS_ROLE', voting)
      await assertRole(acl, finance, AA_ACCOUNT, 'MANAGE_PAYMENTS_ROLE', voting)

      await assertMissingRole(acl, finance, 'CHANGE_PERIOD_ROLE')
      await assertMissingRole(acl, finance, 'CHANGE_BUDGETS_ROLE')
    })

    it('sets up DAO and ACL permissions correctly', async () => {
      await assertRole(acl, dao, AA_ACCOUNT, 'APP_MANAGER_ROLE')
      await assertRole(acl, acl, AA_ACCOUNT, 'CREATE_PERMISSIONS_ROLE')

      await assertRoleNotGranted(acl, dao, 'APP_MANAGER_ROLE', template)
      await assertRoleNotGranted(acl, acl, 'CREATE_PERMISSIONS_ROLE', template)
    })

    it('sets up EVM scripts registry permissions correctly', async () => {
      const reg = await EVMScriptRegistry.at(await acl.getEVMScriptRegistry())
      await assertRole(acl, reg, voting, 'REGISTRY_ADD_EXECUTOR_ROLE')
      await assertRole(acl, reg, voting, 'REGISTRY_MANAGER_ROLE')
    })

    it('should have vault app correctly setup', async () => {
      assert.isTrue(await vault.hasInitialized(), 'vault not initialized')

      assert.equal(await dao.recoveryVaultAppId(), APP_IDS.vault, 'vault app is not being used as the vault app of the DAO')
      assert.equal(web3.toChecksumAddress(await finance.vault()), vault.address, 'finance vault is not the vault app')
      assert.equal(web3.toChecksumAddress(await dao.getRecoveryVault()), vault.address, 'vault app is not being used as the vault app of the DAO')

      await assertRole(acl, vault, AA_ACCOUNT, 'TRANSFER_ROLE', finance)
    })

    it('should have an approvals app correctly setup', async () => {
      assert.isTrue(await approvals.hasInitialized(), 'approvals not initialized')

      await assertRole(acl, approvals, AA_ACCOUNT, 'SUBMIT_ROLE', { address: ANY_ADDRESS })
      await assertRole(acl, approvals, AA_ACCOUNT, 'APPROVE_ROLE')
      await assertRole(acl, approvals, AA_ACCOUNT, 'REJECT_ROLE')
    })
  }

  const itFailsAsExpected = (newInstanceFuncName, ...prependParams) => {
    let newInstanceFunc

    before('identify function to use', async () => {
      newInstanceFunc = template[newInstanceFuncName]
    })

    it('reverts when no members were given', async () => {
      await assertRevert(
        newInstanceFunc(...prependParams, randomId(), [], VOTING_SETTINGS, FINANCE_PERIOD, approvalsNameHash, aaAccount),
        'NEST_TEMPLATE_MISSING_MEMBERS'
      )
    })

    it('reverts when an empty id is provided', async () => {
      await assertRevert(
        newInstanceFunc(...prependParams, '', MEMBERS, VOTING_SETTINGS, FINANCE_PERIOD, approvalsNameHash, aaAccount),
        'TEMPLATE_INVALID_ID'
      )
    })

    it('reverts when an invalid financePeriod is provided', async () => {
      await assertRevert(
        newInstanceFunc(...prependParams, randomId(), MEMBERS, VOTING_SETTINGS, 0, approvalsNameHash, aaAccount),
        'NEST_TEMPLATE_BAD_FINANCE_PERIOD'
      )
    })

    it('reverts when an invalid approvalsNameHash is provided', async () => {
      await assertRevert(
        newInstanceFunc(...prependParams, randomId(), MEMBERS, VOTING_SETTINGS, FINANCE_PERIOD, 0, aaAccount),
        'NEST_TEMPLATE_BAD_APPROVALS'
      )
    })

    it('reverts when an invalid aaAccount is provided', async () => {
      await assertRevert(
        newInstanceFunc(...prependParams, randomId(), MEMBERS, VOTING_SETTINGS, FINANCE_PERIOD, approvalsNameHash, ZERO_ADDRESS),
        'NEST_TEMPLATE_BAD_AA_ACCOUNT'
      )
    })

    it('reverts when invalid vote settings are provided', async () => {
      await assertRevert(
        newInstanceFunc(...prependParams, randomId(), MEMBERS, [0, MIN_ACCEPTANCE_QUORUM, VOTE_DURATION], FINANCE_PERIOD, approvalsNameHash, aaAccount),
        'NEST_TEMPLATE_BAD_SUPPORT'
      )
      await assertRevert(
        newInstanceFunc(...prependParams, randomId(), MEMBERS, [SUPPORT_REQUIRED, 0, VOTE_DURATION], FINANCE_PERIOD, approvalsNameHash, aaAccount),
        'NEST_TEMPLATE_BAD_ACCEPTANCE'
      )
      await assertRevert(
        newInstanceFunc(...prependParams, randomId(), MEMBERS, [SUPPORT_REQUIRED, MIN_ACCEPTANCE_QUORUM, 0], FINANCE_PERIOD, approvalsNameHash, aaAccount),
        'NEST_TEMPLATE_BAD_DURATION'
      )
    })
  }

  const itCostsUpTo = (expectedCosts, receipts) => {
    const expectedTotalCost = expectedCosts.reduce((total, expectedCost) => total += expectedCost, 0)

    let totalCost = 0

    for (let i = 0; i < expectedCosts.length; i++) {
      const expectedCost = expectedCosts[i]
      const receipt = receipts[i]

      const cost = receipt.receipt.gasUsed
      assert.isAtMost(cost, expectedCost, `call should cost up to ${expectedCost} gas`)

      totalCost += cost
    }

    assert.isAtMost(totalCost, expectedTotalCost, `total costs should be up to ${expectedTotalCost} gas`)
  }

  context('when creating instances with separate transactions', () => {
    context('when the creation fails', () => {
      context('when there was no token created before', () => {
        it('reverts', async () => {
          await assertRevert(template.newInstance(randomId(), MEMBERS, VOTING_SETTINGS, FINANCE_PERIOD, approvalsNameHash, aaAccount), 'TEMPLATE_MISSING_TOKEN_CACHE')
        })
      })

      context('when there was a token created', () => {
        before('create token', async () => {
          await template.newToken(TOKEN_NAME, TOKEN_SYMBOL)
        })

        itFailsAsExpected('newInstance')
      })
    })

    context('when the creation succeeds', () => {
      const createDAO = () => {
        before('create entity', async () => {
          daoID = randomId()
          const tokenReceipt = await template.newToken(TOKEN_NAME, TOKEN_SYMBOL, { from: owner })
          const instanceReceipt = await template.newInstance(daoID, MEMBERS, VOTING_SETTINGS, FINANCE_PERIOD, approvalsNameHash, aaAccount, { from: owner })
          await loadDAO(tokenReceipt, instanceReceipt)
          itCostsUpTo([1.71e6, 5.58e6], [tokenReceipt, instanceReceipt])
        })
      }

      createDAO()
      itSetupsDAOCorrectly()
    })
  })

  context('when creating instances with a single transaction', () => {
    context('when the creation fails', () => {
      before('create token', async () => {
        await template.newToken(TOKEN_NAME, TOKEN_SYMBOL)
      })

      itFailsAsExpected('newInstance')
    })

    context('when the creation succeeds', () => {
      const createDAO = () => {
        before('create entity', async () => {
          daoID = randomId()
          const instanceReceipt = await template.newTokenAndInstance(TOKEN_NAME, TOKEN_SYMBOL, daoID, MEMBERS, VOTING_SETTINGS, FINANCE_PERIOD, approvalsNameHash, aaAccount, { from: owner })
          await loadDAO(instanceReceipt, instanceReceipt)
          itCostsUpTo([7.29e6], [instanceReceipt])
        })
      }

      createDAO()
      itSetupsDAOCorrectly()
    })
  })
})
