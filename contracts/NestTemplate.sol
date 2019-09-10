pragma solidity 0.4.24;

import "@aragon/templates-shared/contracts/TokenCache.sol";
import "@aragon/templates-shared/contracts/BaseTemplate.sol";

import "@aragon/approvals/contracts/Approvals.sol";


contract NestTemplate is BaseTemplate, TokenCache {
    string constant private ERROR_MISSING_MEMBERS = "NEST_TEMPLATE_MISSING_MEMBERS";
    string constant private ERROR_BAD_FINANCE_PERIOD = "NEST_TEMPLATE_BAD_FINANCE_PERIOD";
    string constant private ERROR_BAD_VOTE_SUPPORT = "NEST_TEMPLATE_BAD_SUPPORT";
    string constant private ERROR_BAD_VOTE_ACCEPTANCE = "NEST_TEMPLATE_BAD_ACCEPTANCE";
    string constant private ERROR_BAD_VOTE_DURATION = "NEST_TEMPLATE_BAD_DURATION";
    string constant private ERROR_BAD_APPROVALS = "NEST_TEMPLATE_BAD_APPROVALS";
    string constant private ERROR_BAD_AA_ACCOUNT = "NEST_TEMPLATE_BAD_AA_ACCOUNT";

    address constant private ANY_ADDRESS = 0xFFfFfFffFFfffFFfFFfFFFFFffFFFffffFfFFFfF;

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

    function newToken(string memory _name, string memory _symbol) public returns (MiniMeToken) {
        MiniMeToken token = _createToken(_name, _symbol, TOKEN_DECIMALS);
        _cacheToken(token, msg.sender);
        return token;
    }

    function newInstance(
        string memory _id,
        address[] memory _members,
        uint64[3] memory _votingSettings,
        uint64 _financePeriod,
        bytes32 _approvalsNameHash,
        address _aaAccount
    )
        public
	{
        _validateParameters(_id, _members, _votingSettings, _financePeriod, _approvalsNameHash, _aaAccount);

        (Kernel dao, ACL acl) = _createDAO();
        (Finance finance, Voting voting) = _setupApps(dao, acl, _members, _votingSettings, _financePeriod, _approvalsNameHash, _aaAccount);
        _transferRootPermissionsFromTemplateAndFinalizeDAO(dao, _aaAccount);
        _registerID(_id, dao);
    }

    function newTokenAndInstance(
        string memory _tokenName,
        string memory _tokenSymbol,
        string memory _id,
        address[] memory _members,
        uint64[3] memory _votingSettings,
        uint64 _financePeriod,
        bytes32 _approvalsNameHash,
        address _aaAccount
    )
        public
	{
        newToken(_tokenName, _tokenSymbol);
        newInstance(_id, _members, _votingSettings, _financePeriod, _approvalsNameHash, _aaAccount);
    }

    function _setupApps(
        Kernel _dao,
        ACL _acl,
        address[] memory _members,
        uint64[3] memory _votingSettings,
        uint64 _financePeriod,
        bytes32 _approvalsNameHash,
        address _aaAccount
    )
        internal
        returns (Finance, Voting)
    {
        MiniMeToken token = _popTokenCache(msg.sender);
        Vault vault = _installVaultApp(_dao);
        Finance finance = _installFinanceApp(_dao, vault, _financePeriod);
        TokenManager tokenManager = _installTokenManagerApp(_dao, token, TOKEN_TRANSFERABLE, TOKEN_MAX_PER_ACCOUNT);
        Voting voting = _installVotingApp(_dao, token, _votingSettings);
        Approvals approvals = _installApprovalsApp(_dao, _approvalsNameHash);

        _mintTokens(_acl, tokenManager, _members, 1);
        _setupPermissions(_acl, vault, voting, finance, tokenManager, approvals, _aaAccount);

        return (finance, voting);
    }

    function _installApprovalsApp(Kernel _dao, bytes32 _approvalsNameHash) internal returns (Approvals) {
        bytes memory initializeData = abi.encodeWithSelector(Approvals(0).initialize.selector);
        return Approvals(_installNonDefaultApp(_dao, _approvalsNameHash, initializeData));
    }

    function _setupPermissions(
        ACL _acl,
        Vault _vault,
        Voting _voting,
        Finance _finance,
        TokenManager _tokenManager,
        Approvals _approvals,
        address _aaAccount
    )
        internal
    {
        _createVaultPermissions(_acl, _vault, _finance, _aaAccount);
        _createFinancePermissions(_acl, _finance, _voting, _aaAccount);
        _createFinanceCreatePaymentsPermission(_acl, _finance, _voting, _aaAccount);
        _createEvmScriptsRegistryPermissions(_acl, _voting, _voting);
        _createVotingPermissions(_acl, _voting, _voting, _tokenManager, _aaAccount);
        _createCustomTokenManagerPermissions(_acl, _tokenManager, _voting, _aaAccount);
        _createApprovalsPermissions(_acl, _approvals, _aaAccount);
    }

    function _createCustomTokenManagerPermissions(ACL _acl, TokenManager _tokenManager, Voting _voting, address _aaAccount) internal {
        _acl.createPermission(_voting, _tokenManager, _tokenManager.MINT_ROLE(), address(this));
        _acl.createPermission(_voting, _tokenManager, _tokenManager.BURN_ROLE(), address(this));

        _acl.grantPermission(_aaAccount, _tokenManager, _tokenManager.MINT_ROLE());
        _acl.grantPermission(_aaAccount, _tokenManager, _tokenManager.BURN_ROLE());

        _acl.setPermissionManager(_aaAccount, _tokenManager, _tokenManager.MINT_ROLE());
        _acl.setPermissionManager(_aaAccount, _tokenManager, _tokenManager.BURN_ROLE());
    }

    function _createApprovalsPermissions(ACL _acl, Approvals _approvals, address _aaAccount) internal {
        _acl.createPermission(ANY_ADDRESS, _approvals, _approvals.SUBMIT_ROLE(), _aaAccount);
        _acl.createPermission(_aaAccount, _approvals, _approvals.APPROVE_ROLE(), _aaAccount);
        _acl.createPermission(_aaAccount, _approvals, _approvals.REJECT_ROLE(), _aaAccount);
    }

    function _validateParameters(
        string memory _id,
        address[] memory _members,
        uint64[3] memory _votingSettings,
        uint64 _financePeriod,
        bytes32 _approvalsNameHash,
        address _aaAccount
    )
        private pure
    {
        _validateId(_id);

        require(_members.length > 0, ERROR_MISSING_MEMBERS);

        require(_financePeriod > 0, ERROR_BAD_FINANCE_PERIOD);

        require(_votingSettings[0] > 0, ERROR_BAD_VOTE_SUPPORT);
        require(_votingSettings[1] > 0, ERROR_BAD_VOTE_ACCEPTANCE);
        require(_votingSettings[2] > 0, ERROR_BAD_VOTE_DURATION);

        require(_approvalsNameHash[0] != 0, ERROR_BAD_APPROVALS);

        require(_aaAccount != address(0), ERROR_BAD_AA_ACCOUNT);
    }
}

