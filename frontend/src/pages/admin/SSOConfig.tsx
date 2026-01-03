import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  KeyRound,
  Shield,
  Settings,
  Check,
  X,
  ExternalLink,
  AlertTriangle,
  Info,
  Copy,
  Eye,
  EyeOff,
  RefreshCw,
  TestTube,
  Save,
  Users,
  Lock,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';

type SSOProvider = 'none' | 'oidc' | 'saml';

interface OIDCConfig {
  enabled: boolean;
  providerName: string;
  issuerUrl: string;
  clientId: string;
  clientSecret: string;
  scopes: string;
  usernameClaim: string;
  groupsClaim: string;
}

interface SAMLConfig {
  enabled: boolean;
  providerName: string;
  entityId: string;
  ssoUrl: string;
  certificate: string;
  signAuthnRequest: boolean;
  wantAssertionsSigned: boolean;
}

interface LDAPConfig {
  enabled: boolean;
  serverUrl: string;
  baseDn: string;
  bindDn: string;
  bindPassword: string;
  userFilter: string;
  groupFilter: string;
  useTls: boolean;
}

export function SSOConfig() {
  const [activeProvider, setActiveProvider] = useState<SSOProvider>('oidc');
  const [showSecrets, setShowSecrets] = useState(false);
  const [testStatus, setTestStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');

  // Mock OIDC configuration
  const [oidcConfig, setOidcConfig] = useState<OIDCConfig>({
    enabled: true,
    providerName: 'Okta',
    issuerUrl: 'https://company.okta.com/oauth2/default',
    clientId: 'abc123def456ghi789',
    clientSecret: 'super_secret_client_secret_here',
    scopes: 'openid profile email groups',
    usernameClaim: 'preferred_username',
    groupsClaim: 'groups',
  });

  // Mock SAML configuration
  const [samlConfig, setSamlConfig] = useState<SAMLConfig>({
    enabled: false,
    providerName: 'Azure AD',
    entityId: 'https://quantix.local/saml/metadata',
    ssoUrl: 'https://login.microsoftonline.com/tenant-id/saml2',
    certificate: '-----BEGIN CERTIFICATE-----\nMIIC8DCCAdigAwIBAgIQc...\n-----END CERTIFICATE-----',
    signAuthnRequest: true,
    wantAssertionsSigned: true,
  });

  // Mock LDAP configuration
  const [ldapConfig, setLdapConfig] = useState<LDAPConfig>({
    enabled: false,
    serverUrl: 'ldaps://ldap.company.com:636',
    baseDn: 'dc=company,dc=com',
    bindDn: 'cn=admin,dc=company,dc=com',
    bindPassword: 'ldap_bind_password',
    userFilter: '(&(objectClass=user)(sAMAccountName={username}))',
    groupFilter: '(&(objectClass=group)(member={dn}))',
    useTls: true,
  });

  const handleTest = () => {
    setTestStatus('testing');
    setTimeout(() => {
      setTestStatus(Math.random() > 0.3 ? 'success' : 'error');
    }, 2000);
  };

  const callbackUrls = {
    oidc: 'https://quantix.local/auth/callback/oidc',
    saml: 'https://quantix.local/auth/callback/saml',
    logout: 'https://quantix.local/auth/logout',
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-text-primary flex items-center gap-2">
            <KeyRound className="w-6 h-6 text-accent" />
            SSO Configuration
          </h1>
          <p className="text-text-muted mt-1">
            Configure Single Sign-On with OIDC, SAML, or LDAP
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="secondary" onClick={handleTest} disabled={testStatus === 'testing'}>
            <TestTube className={cn('w-4 h-4', testStatus === 'testing' && 'animate-pulse')} />
            {testStatus === 'testing' ? 'Testing...' : 'Test Connection'}
          </Button>
          <Button>
            <Save className="w-4 h-4" />
            Save Configuration
          </Button>
        </div>
      </div>

      {/* Test Status Banner */}
      <AnimatePresence>
        {testStatus === 'success' && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="p-4 rounded-lg bg-success/10 border border-success/20 flex items-center gap-3"
          >
            <Check className="w-5 h-5 text-success" />
            <p className="text-sm text-success">SSO connection test successful!</p>
          </motion.div>
        )}
        {testStatus === 'error' && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="p-4 rounded-lg bg-error/10 border border-error/20 flex items-center gap-3"
          >
            <X className="w-5 h-5 text-error" />
            <p className="text-sm text-error">SSO connection test failed. Please check your configuration.</p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Provider Selection */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <ProviderCard
          name="OIDC"
          description="OpenID Connect"
          icon={<Shield className="w-6 h-6" />}
          isActive={activeProvider === 'oidc'}
          isEnabled={oidcConfig.enabled}
          onClick={() => setActiveProvider('oidc')}
        />
        <ProviderCard
          name="SAML"
          description="Security Assertion Markup Language"
          icon={<Lock className="w-6 h-6" />}
          isActive={activeProvider === 'saml'}
          isEnabled={samlConfig.enabled}
          onClick={() => setActiveProvider('saml')}
        />
        <ProviderCard
          name="LDAP"
          description="Legacy Directory (Optional)"
          icon={<Users className="w-6 h-6" />}
          isActive={activeProvider === 'none' && ldapConfig.enabled}
          isEnabled={ldapConfig.enabled}
          onClick={() => setActiveProvider('none')}
          isLegacy
        />
      </div>

      {/* OIDC Configuration */}
      {activeProvider === 'oidc' && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="p-6 rounded-xl bg-bg-surface border border-border space-y-6"
        >
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-text-primary flex items-center gap-2">
              <Shield className="w-5 h-5 text-accent" />
              OIDC Configuration
            </h2>
            <label className="flex items-center gap-2 cursor-pointer">
              <span className="text-sm text-text-muted">Enable OIDC</span>
              <ToggleSwitch
                checked={oidcConfig.enabled}
                onChange={(checked) => setOidcConfig({ ...oidcConfig, enabled: checked })}
              />
            </label>
          </div>

          {oidcConfig.enabled && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <ConfigField
                  label="Provider Name"
                  value={oidcConfig.providerName}
                  onChange={(v) => setOidcConfig({ ...oidcConfig, providerName: v })}
                  placeholder="e.g., Okta, Auth0"
                />
                <ConfigField
                  label="Issuer URL"
                  value={oidcConfig.issuerUrl}
                  onChange={(v) => setOidcConfig({ ...oidcConfig, issuerUrl: v })}
                  placeholder="https://provider.com/oauth2"
                />
                <ConfigField
                  label="Client ID"
                  value={oidcConfig.clientId}
                  onChange={(v) => setOidcConfig({ ...oidcConfig, clientId: v })}
                  placeholder="Your OIDC client ID"
                />
                <ConfigField
                  label="Client Secret"
                  value={oidcConfig.clientSecret}
                  onChange={(v) => setOidcConfig({ ...oidcConfig, clientSecret: v })}
                  isSecret
                  showSecret={showSecrets}
                  placeholder="Your OIDC client secret"
                />
              </div>

              <ConfigField
                label="Scopes"
                value={oidcConfig.scopes}
                onChange={(v) => setOidcConfig({ ...oidcConfig, scopes: v })}
                placeholder="openid profile email"
              />

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <ConfigField
                  label="Username Claim"
                  value={oidcConfig.usernameClaim}
                  onChange={(v) => setOidcConfig({ ...oidcConfig, usernameClaim: v })}
                  placeholder="preferred_username"
                />
                <ConfigField
                  label="Groups Claim"
                  value={oidcConfig.groupsClaim}
                  onChange={(v) => setOidcConfig({ ...oidcConfig, groupsClaim: v })}
                  placeholder="groups"
                />
              </div>

              <CallbackUrls urls={callbackUrls} />
            </div>
          )}
        </motion.div>
      )}

      {/* SAML Configuration */}
      {activeProvider === 'saml' && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="p-6 rounded-xl bg-bg-surface border border-border space-y-6"
        >
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-text-primary flex items-center gap-2">
              <Lock className="w-5 h-5 text-accent" />
              SAML Configuration
            </h2>
            <label className="flex items-center gap-2 cursor-pointer">
              <span className="text-sm text-text-muted">Enable SAML</span>
              <ToggleSwitch
                checked={samlConfig.enabled}
                onChange={(checked) => setSamlConfig({ ...samlConfig, enabled: checked })}
              />
            </label>
          </div>

          {samlConfig.enabled && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <ConfigField
                  label="Provider Name"
                  value={samlConfig.providerName}
                  onChange={(v) => setSamlConfig({ ...samlConfig, providerName: v })}
                  placeholder="e.g., Azure AD, Okta"
                />
                <ConfigField
                  label="Entity ID"
                  value={samlConfig.entityId}
                  onChange={(v) => setSamlConfig({ ...samlConfig, entityId: v })}
                  placeholder="https://yourapp.com/saml/metadata"
                />
              </div>

              <ConfigField
                label="SSO URL"
                value={samlConfig.ssoUrl}
                onChange={(v) => setSamlConfig({ ...samlConfig, ssoUrl: v })}
                placeholder="https://provider.com/saml/sso"
              />

              <div>
                <label className="block text-sm font-medium text-text-primary mb-2">
                  IdP Certificate
                </label>
                <textarea
                  className="form-input h-32 font-mono text-xs"
                  value={samlConfig.certificate}
                  onChange={(e) => setSamlConfig({ ...samlConfig, certificate: e.target.value })}
                  placeholder="-----BEGIN CERTIFICATE-----..."
                />
              </div>

              <div className="flex gap-6">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={samlConfig.signAuthnRequest}
                    onChange={(e) => setSamlConfig({ ...samlConfig, signAuthnRequest: e.target.checked })}
                    className="form-checkbox"
                  />
                  <span className="text-sm text-text-primary">Sign AuthN Request</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={samlConfig.wantAssertionsSigned}
                    onChange={(e) => setSamlConfig({ ...samlConfig, wantAssertionsSigned: e.target.checked })}
                    className="form-checkbox"
                  />
                  <span className="text-sm text-text-primary">Require Signed Assertions</span>
                </label>
              </div>

              <CallbackUrls urls={callbackUrls} />
            </div>
          )}
        </motion.div>
      )}

      {/* LDAP Configuration */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="p-6 rounded-xl bg-bg-surface border border-border space-y-6"
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-semibold text-text-primary flex items-center gap-2">
              <Users className="w-5 h-5 text-accent" />
              LDAP / Active Directory
            </h2>
            <Badge variant="warning">Legacy</Badge>
          </div>
          <label className="flex items-center gap-2 cursor-pointer">
            <span className="text-sm text-text-muted">Enable LDAP</span>
            <ToggleSwitch
              checked={ldapConfig.enabled}
              onChange={(checked) => setLdapConfig({ ...ldapConfig, enabled: checked })}
            />
          </label>
        </div>

        {!ldapConfig.enabled && (
          <div className="p-4 rounded-lg bg-info/10 border border-info/20">
            <div className="flex items-start gap-3">
              <Info className="w-5 h-5 text-info shrink-0 mt-0.5" />
              <div>
                <p className="text-sm text-info font-medium">LDAP is disabled by default</p>
                <p className="text-xs text-text-muted mt-1">
                  LDAP is a legacy protocol. We recommend using OIDC or SAML for modern authentication.
                  Enable LDAP only if you need to integrate with legacy Active Directory environments.
                </p>
              </div>
            </div>
          </div>
        )}

        {ldapConfig.enabled && (
          <div className="space-y-4">
            <div className="p-4 rounded-lg bg-warning/10 border border-warning/20">
              <div className="flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 text-warning shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm text-warning font-medium">Security Warning</p>
                  <p className="text-xs text-text-muted mt-1">
                    LDAP is a legacy protocol with known security limitations. 
                    Ensure you use LDAPS (LDAP over TLS) and restrict access to trusted networks.
                  </p>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <ConfigField
                label="Server URL"
                value={ldapConfig.serverUrl}
                onChange={(v) => setLdapConfig({ ...ldapConfig, serverUrl: v })}
                placeholder="ldaps://ldap.company.com:636"
              />
              <ConfigField
                label="Base DN"
                value={ldapConfig.baseDn}
                onChange={(v) => setLdapConfig({ ...ldapConfig, baseDn: v })}
                placeholder="dc=company,dc=com"
              />
              <ConfigField
                label="Bind DN"
                value={ldapConfig.bindDn}
                onChange={(v) => setLdapConfig({ ...ldapConfig, bindDn: v })}
                placeholder="cn=admin,dc=company,dc=com"
              />
              <ConfigField
                label="Bind Password"
                value={ldapConfig.bindPassword}
                onChange={(v) => setLdapConfig({ ...ldapConfig, bindPassword: v })}
                isSecret
                showSecret={showSecrets}
                placeholder="LDAP bind password"
              />
            </div>

            <ConfigField
              label="User Filter"
              value={ldapConfig.userFilter}
              onChange={(v) => setLdapConfig({ ...ldapConfig, userFilter: v })}
              placeholder="(&(objectClass=user)(sAMAccountName={username}))"
            />

            <ConfigField
              label="Group Filter"
              value={ldapConfig.groupFilter}
              onChange={(v) => setLdapConfig({ ...ldapConfig, groupFilter: v })}
              placeholder="(&(objectClass=group)(member={dn}))"
            />

            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={ldapConfig.useTls}
                onChange={(e) => setLdapConfig({ ...ldapConfig, useTls: e.target.checked })}
                className="form-checkbox"
              />
              <span className="text-sm text-text-primary">Use TLS (LDAPS)</span>
            </label>
          </div>
        )}
      </motion.div>

      {/* Show/Hide Secrets Toggle */}
      <div className="flex justify-end">
        <button
          onClick={() => setShowSecrets(!showSecrets)}
          className="flex items-center gap-2 text-sm text-text-muted hover:text-text-primary transition-colors"
        >
          {showSecrets ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          {showSecrets ? 'Hide Secrets' : 'Show Secrets'}
        </button>
      </div>
    </div>
  );
}

function ProviderCard({
  name,
  description,
  icon,
  isActive,
  isEnabled,
  onClick,
  isLegacy,
}: {
  name: string;
  description: string;
  icon: React.ReactNode;
  isActive: boolean;
  isEnabled: boolean;
  onClick: () => void;
  isLegacy?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'p-4 rounded-xl border text-left transition-all',
        isActive
          ? 'bg-accent/10 border-accent/30'
          : 'bg-bg-surface border-border hover:border-border-hover',
      )}
    >
      <div className="flex items-start justify-between mb-3">
        <div className={cn(
          'p-2.5 rounded-lg',
          isActive ? 'bg-accent/20 text-accent' : 'bg-bg-base text-text-muted',
        )}>
          {icon}
        </div>
        <div className="flex items-center gap-2">
          {isLegacy && <Badge variant="warning">Legacy</Badge>}
          {isEnabled && <Badge variant="success">Active</Badge>}
        </div>
      </div>
      <h3 className="font-semibold text-text-primary">{name}</h3>
      <p className="text-sm text-text-muted mt-1">{description}</p>
    </button>
  );
}

function ConfigField({
  label,
  value,
  onChange,
  placeholder,
  isSecret,
  showSecret,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  isSecret?: boolean;
  showSecret?: boolean;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-text-primary mb-2">
        {label}
      </label>
      <input
        type={isSecret && !showSecret ? 'password' : 'text'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="form-input"
      />
    </div>
  );
}

function ToggleSwitch({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <button
      onClick={() => onChange(!checked)}
      className={cn(
        'relative w-11 h-6 rounded-full transition-colors',
        checked ? 'bg-accent' : 'bg-bg-elevated',
      )}
    >
      <motion.div
        animate={{ x: checked ? 20 : 2 }}
        transition={{ type: 'spring', stiffness: 500, damping: 30 }}
        className="absolute top-1 w-4 h-4 rounded-full bg-white shadow"
      />
    </button>
  );
}

function CallbackUrls({ urls }: { urls: { oidc: string; saml: string; logout: string } }) {
  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  return (
    <div className="p-4 rounded-lg bg-bg-base border border-border">
      <h4 className="text-sm font-medium text-text-primary mb-3 flex items-center gap-2">
        <Info className="w-4 h-4 text-info" />
        Callback URLs (for your IdP configuration)
      </h4>
      <div className="space-y-2">
        {Object.entries(urls).map(([key, url]) => (
          <div key={key} className="flex items-center justify-between p-2 rounded bg-bg-surface">
            <div>
              <p className="text-xs text-text-muted capitalize">{key} Callback</p>
              <code className="text-sm text-accent">{url}</code>
            </div>
            <button
              onClick={() => copyToClipboard(url)}
              className="p-2 rounded-lg hover:bg-bg-hover text-text-muted hover:text-text-primary transition-colors"
            >
              <Copy className="w-4 h-4" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

export default SSOConfig;
