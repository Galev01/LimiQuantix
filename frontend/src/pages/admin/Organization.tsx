import { useState } from 'react';
import { motion } from 'framer-motion';
import {
  Building2,
  Palette,
  Mail,
  Phone,
  MapPin,
  Globe,
  Upload,
  Eye,
  Save,
  RefreshCw,
  CreditCard,
  Calendar,
  CheckCircle2,
  Image,
  Type,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';

interface OrganizationSettings {
  name: string;
  domain: string;
  address: string;
  city: string;
  country: string;
  phone: string;
  website: string;
}

interface BrandingSettings {
  primaryColor: string;
  accentColor: string;
  logoUrl: string;
  faviconUrl: string;
  customCss: string;
  emailFooter: string;
}

interface BillingContact {
  name: string;
  email: string;
  phone: string;
  address: string;
}

export function Organization() {
  const [activeTab, setActiveTab] = useState<'general' | 'branding' | 'billing'>('general');

  // Mock organization data
  const [orgSettings, setOrgSettings] = useState<OrganizationSettings>({
    name: 'Acme Corporation',
    domain: 'acme.com',
    address: '123 Tech Boulevard, Suite 400',
    city: 'San Francisco, CA 94105',
    country: 'United States',
    phone: '+1 (555) 123-4567',
    website: 'https://acme.com',
  });

  // Mock branding data
  const [branding, setBranding] = useState<BrandingSettings>({
    primaryColor: '#3b82f6',
    accentColor: '#8b5cf6',
    logoUrl: '/assets/Logo.png',
    faviconUrl: '/assets/icon.png',
    customCss: '',
    emailFooter: '© 2026 Acme Corporation. All rights reserved.',
  });

  // Mock billing contact
  const [billingContact, setBillingContact] = useState<BillingContact>({
    name: 'Jane Smith',
    email: 'billing@acme.com',
    phone: '+1 (555) 987-6543',
    address: '123 Tech Boulevard, Suite 400, San Francisco, CA 94105',
  });

  // Mock plan info (read-only)
  const planInfo = {
    name: 'Professional',
    status: 'active',
    startDate: '2025-06-01',
    renewalDate: '2026-02-01',
    seats: 50,
    usedSeats: 42,
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-text-primary flex items-center gap-2">
            <Building2 className="w-6 h-6 text-accent" />
            Organization Settings
          </h1>
          <p className="text-text-muted mt-1">
            Manage your organization profile, branding, and billing information
          </p>
        </div>
        <Button>
          <Save className="w-4 h-4" />
          Save Changes
        </Button>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 p-1 rounded-lg bg-bg-base border border-border w-fit">
        {(['general', 'branding', 'billing'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={cn(
              'px-4 py-2 rounded-md text-sm font-medium transition-all capitalize',
              activeTab === tab
                ? 'bg-accent text-white'
                : 'text-text-muted hover:text-text-primary',
            )}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* General Tab */}
      {activeTab === 'general' && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="space-y-6"
        >
          {/* Organization Info */}
          <div className="p-6 rounded-xl bg-bg-surface border border-border">
            <h2 className="text-lg font-semibold text-text-primary mb-6 flex items-center gap-2">
              <Building2 className="w-5 h-5 text-accent" />
              Organization Information
            </h2>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-medium text-text-primary mb-2">
                  Organization Name
                </label>
                <input
                  type="text"
                  className="form-input"
                  value={orgSettings.name}
                  onChange={(e) => setOrgSettings({ ...orgSettings, name: e.target.value })}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-text-primary mb-2">
                  Domain
                </label>
                <input
                  type="text"
                  className="form-input"
                  value={orgSettings.domain}
                  onChange={(e) => setOrgSettings({ ...orgSettings, domain: e.target.value })}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-text-primary mb-2">
                  Website
                </label>
                <div className="relative">
                  <Globe className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
                  <input
                    type="url"
                    className="form-input pl-10"
                    value={orgSettings.website}
                    onChange={(e) => setOrgSettings({ ...orgSettings, website: e.target.value })}
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-text-primary mb-2">
                  Phone
                </label>
                <div className="relative">
                  <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
                  <input
                    type="tel"
                    className="form-input pl-10"
                    value={orgSettings.phone}
                    onChange={(e) => setOrgSettings({ ...orgSettings, phone: e.target.value })}
                  />
                </div>
              </div>
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-text-primary mb-2">
                  Address
                </label>
                <div className="relative">
                  <MapPin className="absolute left-3 top-3 w-4 h-4 text-text-muted" />
                  <input
                    type="text"
                    className="form-input pl-10"
                    value={orgSettings.address}
                    onChange={(e) => setOrgSettings({ ...orgSettings, address: e.target.value })}
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-text-primary mb-2">
                  City
                </label>
                <input
                  type="text"
                  className="form-input"
                  value={orgSettings.city}
                  onChange={(e) => setOrgSettings({ ...orgSettings, city: e.target.value })}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-text-primary mb-2">
                  Country
                </label>
                <select
                  className="form-select"
                  value={orgSettings.country}
                  onChange={(e) => setOrgSettings({ ...orgSettings, country: e.target.value })}
                >
                  <option value="United States">United States</option>
                  <option value="United Kingdom">United Kingdom</option>
                  <option value="Germany">Germany</option>
                  <option value="France">France</option>
                  <option value="Canada">Canada</option>
                  <option value="Australia">Australia</option>
                </select>
              </div>
            </div>
          </div>

          {/* Plan Information (Read-Only) */}
          <div className="p-6 rounded-xl bg-bg-surface border border-border">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg font-semibold text-text-primary flex items-center gap-2">
                <CreditCard className="w-5 h-5 text-accent" />
                Plan Information
              </h2>
              <Badge variant="info">Read Only</Badge>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <PlanInfoCard label="Current Plan" value={planInfo.name} icon={<CheckCircle2 className="w-4 h-4" />} />
              <PlanInfoCard label="Status" value={planInfo.status} icon={<CheckCircle2 className="w-4 h-4" />} variant="success" />
              <PlanInfoCard label="Seats Used" value={`${planInfo.usedSeats} / ${planInfo.seats}`} icon={<Building2 className="w-4 h-4" />} />
              <PlanInfoCard label="Renewal Date" value={new Date(planInfo.renewalDate).toLocaleDateString()} icon={<Calendar className="w-4 h-4" />} />
            </div>

            <p className="text-sm text-text-muted mt-4">
              To change your plan, visit the <a href="/admin/subscriptions" className="text-accent hover:underline">Subscriptions</a> page.
            </p>
          </div>
        </motion.div>
      )}

      {/* Branding Tab */}
      {activeTab === 'branding' && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="space-y-6"
        >
          {/* Logo & Favicon */}
          <div className="p-6 rounded-xl bg-bg-surface border border-border">
            <h2 className="text-lg font-semibold text-text-primary mb-6 flex items-center gap-2">
              <Image className="w-5 h-5 text-accent" />
              Logo & Favicon
            </h2>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-medium text-text-primary mb-3">
                  Logo
                </label>
                <div className="flex items-center gap-4">
                  <div className="w-20 h-20 rounded-lg bg-bg-base border border-border flex items-center justify-center overflow-hidden">
                    <img src={branding.logoUrl} alt="Logo" className="max-w-full max-h-full object-contain" />
                  </div>
                  <div>
                    <Button variant="secondary" size="sm">
                      <Upload className="w-4 h-4" />
                      Upload Logo
                    </Button>
                    <p className="text-xs text-text-muted mt-2">PNG, SVG up to 1MB. 200x50px recommended.</p>
                  </div>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-text-primary mb-3">
                  Favicon
                </label>
                <div className="flex items-center gap-4">
                  <div className="w-20 h-20 rounded-lg bg-bg-base border border-border flex items-center justify-center overflow-hidden">
                    <img src={branding.faviconUrl} alt="Favicon" className="w-8 h-8 object-contain" />
                  </div>
                  <div>
                    <Button variant="secondary" size="sm">
                      <Upload className="w-4 h-4" />
                      Upload Favicon
                    </Button>
                    <p className="text-xs text-text-muted mt-2">PNG, ICO. 32x32px recommended.</p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Colors */}
          <div className="p-6 rounded-xl bg-bg-surface border border-border">
            <h2 className="text-lg font-semibold text-text-primary mb-6 flex items-center gap-2">
              <Palette className="w-5 h-5 text-accent" />
              Brand Colors
            </h2>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-medium text-text-primary mb-2">
                  Primary Color
                </label>
                <div className="flex items-center gap-3">
                  <input
                    type="color"
                    value={branding.primaryColor}
                    onChange={(e) => setBranding({ ...branding, primaryColor: e.target.value })}
                    className="w-12 h-12 rounded-lg cursor-pointer border-0"
                  />
                  <input
                    type="text"
                    value={branding.primaryColor}
                    onChange={(e) => setBranding({ ...branding, primaryColor: e.target.value })}
                    className="form-input font-mono"
                    placeholder="#3b82f6"
                  />
                </div>
                <p className="text-xs text-text-muted mt-2">Used for buttons, links, and active states</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-text-primary mb-2">
                  Accent Color
                </label>
                <div className="flex items-center gap-3">
                  <input
                    type="color"
                    value={branding.accentColor}
                    onChange={(e) => setBranding({ ...branding, accentColor: e.target.value })}
                    className="w-12 h-12 rounded-lg cursor-pointer border-0"
                  />
                  <input
                    type="text"
                    value={branding.accentColor}
                    onChange={(e) => setBranding({ ...branding, accentColor: e.target.value })}
                    className="form-input font-mono"
                    placeholder="#8b5cf6"
                  />
                </div>
                <p className="text-xs text-text-muted mt-2">Used for highlights and secondary actions</p>
              </div>
            </div>

            {/* Preview */}
            <div className="mt-6 p-4 rounded-lg bg-bg-base border border-border">
              <p className="text-sm text-text-muted mb-3">Preview</p>
              <div className="flex items-center gap-4">
                <button
                  style={{ backgroundColor: branding.primaryColor }}
                  className="px-4 py-2 rounded-lg text-white text-sm font-medium"
                >
                  Primary Button
                </button>
                <button
                  style={{ backgroundColor: branding.accentColor }}
                  className="px-4 py-2 rounded-lg text-white text-sm font-medium"
                >
                  Accent Button
                </button>
                <span style={{ color: branding.primaryColor }} className="text-sm font-medium">
                  Primary Link
                </span>
              </div>
            </div>
          </div>

          {/* Custom CSS */}
          <div className="p-6 rounded-xl bg-bg-surface border border-border">
            <h2 className="text-lg font-semibold text-text-primary mb-4 flex items-center gap-2">
              <Type className="w-5 h-5 text-accent" />
              Custom CSS
            </h2>
            <p className="text-sm text-text-muted mb-4">
              Add custom CSS to further customize the appearance. Advanced users only.
            </p>
            <textarea
              className="form-input h-32 font-mono text-sm"
              value={branding.customCss}
              onChange={(e) => setBranding({ ...branding, customCss: e.target.value })}
              placeholder="/* Custom CSS here */"
            />
          </div>

          {/* Email Footer */}
          <div className="p-6 rounded-xl bg-bg-surface border border-border">
            <h2 className="text-lg font-semibold text-text-primary mb-4 flex items-center gap-2">
              <Mail className="w-5 h-5 text-accent" />
              Email Footer
            </h2>
            <p className="text-sm text-text-muted mb-4">
              This text appears at the bottom of all system-generated emails.
            </p>
            <textarea
              className="form-input h-20"
              value={branding.emailFooter}
              onChange={(e) => setBranding({ ...branding, emailFooter: e.target.value })}
              placeholder="© 2026 Your Company. All rights reserved."
            />
          </div>
        </motion.div>
      )}

      {/* Billing Tab */}
      {activeTab === 'billing' && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="space-y-6"
        >
          {/* Billing Contact */}
          <div className="p-6 rounded-xl bg-bg-surface border border-border">
            <h2 className="text-lg font-semibold text-text-primary mb-6 flex items-center gap-2">
              <CreditCard className="w-5 h-5 text-accent" />
              Billing Contact
            </h2>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-medium text-text-primary mb-2">
                  Contact Name
                </label>
                <input
                  type="text"
                  className="form-input"
                  value={billingContact.name}
                  onChange={(e) => setBillingContact({ ...billingContact, name: e.target.value })}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-text-primary mb-2">
                  Billing Email
                </label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
                  <input
                    type="email"
                    className="form-input pl-10"
                    value={billingContact.email}
                    onChange={(e) => setBillingContact({ ...billingContact, email: e.target.value })}
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-text-primary mb-2">
                  Phone
                </label>
                <div className="relative">
                  <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
                  <input
                    type="tel"
                    className="form-input pl-10"
                    value={billingContact.phone}
                    onChange={(e) => setBillingContact({ ...billingContact, phone: e.target.value })}
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-text-primary mb-2">
                  Billing Address
                </label>
                <div className="relative">
                  <MapPin className="absolute left-3 top-3 w-4 h-4 text-text-muted" />
                  <input
                    type="text"
                    className="form-input pl-10"
                    value={billingContact.address}
                    onChange={(e) => setBillingContact({ ...billingContact, address: e.target.value })}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Tax Information */}
          <div className="p-6 rounded-xl bg-bg-surface border border-border">
            <h2 className="text-lg font-semibold text-text-primary mb-6">
              Tax Information
            </h2>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-medium text-text-primary mb-2">
                  Tax ID / VAT Number
                </label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="e.g., US12-3456789"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-text-primary mb-2">
                  Tax Region
                </label>
                <select className="form-select">
                  <option value="us">United States</option>
                  <option value="eu">European Union</option>
                  <option value="uk">United Kingdom</option>
                  <option value="other">Other</option>
                </select>
              </div>
            </div>
          </div>

          {/* Invoice Delivery */}
          <div className="p-6 rounded-xl bg-bg-surface border border-border">
            <h2 className="text-lg font-semibold text-text-primary mb-4">
              Invoice Delivery
            </h2>

            <div className="space-y-3">
              <label className="flex items-center gap-3 p-3 rounded-lg bg-bg-base border border-border cursor-pointer hover:bg-bg-hover">
                <input type="radio" name="invoice-delivery" className="form-radio" defaultChecked />
                <div>
                  <p className="text-sm font-medium text-text-primary">Email Only</p>
                  <p className="text-xs text-text-muted">Invoices sent to billing email</p>
                </div>
              </label>
              <label className="flex items-center gap-3 p-3 rounded-lg bg-bg-base border border-border cursor-pointer hover:bg-bg-hover">
                <input type="radio" name="invoice-delivery" className="form-radio" />
                <div>
                  <p className="text-sm font-medium text-text-primary">Email + Portal</p>
                  <p className="text-xs text-text-muted">Also available in billing portal</p>
                </div>
              </label>
            </div>
          </div>
        </motion.div>
      )}
    </div>
  );
}

function PlanInfoCard({
  label,
  value,
  icon,
  variant,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
  variant?: 'success';
}) {
  return (
    <div className="p-4 rounded-lg bg-bg-base border border-border">
      <div className={cn('flex items-center gap-2 mb-2', variant === 'success' ? 'text-success' : 'text-text-muted')}>
        {icon}
        <span className="text-xs font-medium uppercase">{label}</span>
      </div>
      <p className="text-lg font-semibold text-text-primary capitalize">{value}</p>
    </div>
  );
}

export default Organization;
