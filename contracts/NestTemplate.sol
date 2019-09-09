pragma solidity 0.4.24;

import "@aragon/templates-shared/contracts/TokenCache.sol";
import "@aragon/templates-shared/contracts/BaseTemplate.sol";


contract NestTemplate is BaseTemplate, TokenCache {
    string constant private ERROR_MISSING_MEMBERS = "NEST_TEMPLATE_MISSING_MEMBERS";
    string constant private ERROR_BAD_VOTE_SETTINGS = "NEST_TEMPLATE_BAD_VOTE_SETTINGS";
    string constant private ERROR_BAD_FINANCE_PERIOD = "NEST_TEMPLATE_BAD_VOTE_SETTINGS";

    bool constant private TOKEN_TRANSFERABLE = false;
    uint8 constant private TOKEN_DECIMALS = uint8(0);
    uint256 constant private TOKEN_MAX_PER_ACCOUNT = uint256(1);

    constructor(DAOFactory _daoFactory, ENS _ens, MiniMeTokenFactory _miniMeFactory, IFIFSResolvingRegistrar _aragonID)
        BaseTemplate(_daoFactory, _ens, _miniMeFactory, _aragonID)
        public
    {
        _ensureAragonIdIsValid(_aragonID);
        _ensureMiniMeFactoryIsValid(_miniMeFactory);
    }

    /**
    * @dev Create a new MiniMe token and deploy a Membership DAO.
    *      to be setup due to gas limits.
    * @param _tokenName String with the name for the token used by share holders in the organization
    * @param _tokenSymbol String with the symbol for the token used by share holders in the organization
    * @param _id String with the name for org, will assign `[id].aragonid.eth`
    * @param _members Array of member addresses (1 token will be minted for each member)
    * @param _votingSettings Array of [supportRequired, minAcceptanceQuorum, voteDuration] to set up the voting app of the organization
    * @param _financePeriod Initial duration for accounting periods.
    */
    function newTokenAndInstance(
        string _tokenName,
        string _tokenSymbol,
        string _id,
        address[] _members,
        uint64[3] _votingSettings,
        uint64 _financePeriod
    )
        external
    {
        newToken(_tokenName, _tokenSymbol);
        newInstance(_id, _members, _votingSettings, _financePeriod);
    }

    /**
    * @dev Create a new MiniMe token and cache it for the user
    * @param _name String with the name for the token used by share holders in the organization
    * @param _symbol String with the symbol for the token used by share holders in the organization
    */
    function newToken(string memory _name, string memory _symbol) public returns (MiniMeToken) {
        MiniMeToken token = _createToken(_name, _symbol, TOKEN_DECIMALS);
        _cacheToken(token, msg.sender);
        return token;
    }

    /**
    * @dev Deploy a Membership DAO using a previously cached MiniMe token
    * @param _id String with the name for org, will assign `[id].aragonid.eth`
    * @param _members Array of member addresses (1 token will be minted for each member)
    * @param _votingSettings Array of [supportRequired, minAcceptanceQuorum, voteDuration] to set up the voting app of the organization
    * @param _financePeriod Initial duration for accounting periods.
    */
    function newInstance(
        string memory _id,
        address[] memory _members,
        uint64[3] memory _votingSettings,
        uint64 _financePeriod
    )
        public
	{
        _validateId(_id);
        _validateMembershipSettings(_members, _votingSettings, _financePeriod);

        (Kernel dao, ACL acl) = _createDAO();
        (Finance finance, Voting voting) = _setupApps(dao, acl, _members, _votingSettings, _financePeriod);
        _transferCreatePaymentManagerFromTemplate(acl, finance, voting);
        _transferRootPermissionsFromTemplateAndFinalizeDAO(dao, voting);
        _registerID(_id, dao);
    }

    function _setupApps(
        Kernel _dao,
        ACL _acl,
        address[] memory _members,
        uint64[3] memory _votingSettings,
        uint64 _financePeriod
    )
        internal
        returns (Finance, Voting)
    {
        MiniMeToken token = _popTokenCache(msg.sender);
        Vault vault = _installVaultApp(_dao);
        Finance finance = _installFinanceApp(_dao, vault, _financePeriod);
        TokenManager tokenManager = _installTokenManagerApp(_dao, token, TOKEN_TRANSFERABLE, TOKEN_MAX_PER_ACCOUNT);
        Voting voting = _installVotingApp(_dao, token, _votingSettings);

        _mintTokens(_acl, tokenManager, _members, 1);
        _setupPermissions(_acl, vault, voting, finance, tokenManager);

        return (finance, voting);
    }

    function _setupPermissions(
        ACL _acl,
        Vault _vault,
        Voting _voting,
        Finance _finance,
        TokenManager _tokenManager
    )
        internal
    {
        _createVaultPermissions(_acl, _vault, _finance, _voting);
        _createFinancePermissions(_acl, _finance, _voting, _voting);
        _createFinanceCreatePaymentsPermission(_acl, _finance, _voting, address(this));
        _createEvmScriptsRegistryPermissions(_acl, _voting, _voting);
        _createVotingPermissions(_acl, _voting, _voting, _tokenManager, _voting);
        _createTokenManagerPermissions(_acl, _tokenManager, _voting, _voting);
    }

    function _validateMembershipSettings(address[] memory _members, uint64[3] memory _votingSettings, uint64 _financePeriod) private pure {
        require(_members.length > 0, ERROR_MISSING_MEMBERS);
        require(_financePeriod > 0, ERROR_BAD_FINANCE_PERIOD);
        require(_votingSettings.length == 3, ERROR_BAD_VOTE_SETTINGS);
    }
}

