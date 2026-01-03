import { motion } from 'framer-motion';
import {
  CreditCard,
  Check,
  X,
  ExternalLink,
  Calendar,
  Users,
  Server,
  HardDrive,
  Network,
  Zap,
  Crown,
  Shield,
  Clock,
  AlertCircle,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';

interface PlanFeature {
  name: string;
  included: boolean;
  limit?: string;
}

interface Plan {
  id: string;
  name: string;
  tier: 'starter' | 'professional' | 'enterprise';
  price: number;
  billingCycle: 'monthly' | 'yearly';
  features: PlanFeature[];
  limits: {
    vms: number | 'unlimited';
    hosts: number | 'unlimited';
    storage: string;
    users: number | 'unlimited';
    apiCalls: string;
  };
}

export function Subscriptions() {
  // Mock current subscription data
  const currentPlan: Plan = {
    id: 'plan-pro',
    name: 'Professional',
    tier: 'professional',
    price: 499,
    billingCycle: 'monthly',
    features: [
      { name: 'Unlimited VMs', included: true },
      { name: 'Up to 20 hosts', included: true, limit: '20' },
      { name: 'High Availability', included: true },
      { name: 'Live Migration', included: true },
      { name: 'SSO Integration', included: true },
      { name: 'API Access', included: true, limit: '100K/month' },
      { name: 'Priority Support', included: true },
      { name: 'Custom Branding', included: false },
      { name: 'Dedicated Account Manager', included: false },
    ],
    limits: {
      vms: 'unlimited',
      hosts: 20,
      storage: '100 TB',
      users: 50,
      apiCalls: '100K/month',
    },
  };

  const subscription = {
    startDate: '2025-06-01',
    renewalDate: '2026-02-01',
    status: 'active' as const,
    paymentMethod: '**** **** **** 4242',
    billingEmail: 'billing@company.com',
  };

  const usage = {
    vms: { used: 156, limit: 'unlimited' },
    hosts: { used: 12, limit: 20 },
    storage: { used: '48.2 TB', limit: '100 TB' },
    users: { used: 42, limit: 50 },
    apiCalls: { used: '67.2K', limit: '100K' },
  };

  const daysUntilRenewal = Math.ceil(
    (new Date(subscription.renewalDate).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24),
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-text-primary flex items-center gap-2">
            <CreditCard className="w-6 h-6 text-accent" />
            Subscription Plans
          </h1>
          <p className="text-text-muted mt-1">
            View your current plan, usage, and billing information
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="secondary">
            <ExternalLink className="w-4 h-4" />
            Billing Portal
          </Button>
          <Button>
            <Zap className="w-4 h-4" />
            Upgrade Plan
          </Button>
        </div>
      </div>

      {/* Current Plan Overview */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Plan Card */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="lg:col-span-2 p-6 rounded-xl bg-gradient-to-br from-accent/20 via-bg-surface to-bg-surface border border-accent/30"
        >
          <div className="flex items-start justify-between mb-6">
            <div>
              <div className="flex items-center gap-3">
                <div className="p-3 rounded-xl bg-accent/20">
                  <Crown className="w-6 h-6 text-accent" />
                </div>
                <div>
                  <h2 className="text-xl font-bold text-text-primary">{currentPlan.name} Plan</h2>
                  <p className="text-text-muted">Your current subscription</p>
                </div>
              </div>
            </div>
            <Badge variant="success" className="text-sm px-3 py-1">
              Active
            </Badge>
          </div>

          <div className="flex items-baseline gap-1 mb-6">
            <span className="text-4xl font-bold text-text-primary">${currentPlan.price}</span>
            <span className="text-text-muted">/{currentPlan.billingCycle}</span>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-5 gap-4 p-4 rounded-lg bg-bg-base/50">
            <UsageStat icon={<Server className="w-4 h-4" />} label="VMs" value={usage.vms.used} limit={usage.vms.limit} />
            <UsageStat icon={<Server className="w-4 h-4" />} label="Hosts" value={usage.hosts.used} limit={usage.hosts.limit} />
            <UsageStat icon={<HardDrive className="w-4 h-4" />} label="Storage" value={usage.storage.used} limit={usage.storage.limit} />
            <UsageStat icon={<Users className="w-4 h-4" />} label="Users" value={usage.users.used} limit={usage.users.limit} />
            <UsageStat icon={<Network className="w-4 h-4" />} label="API" value={usage.apiCalls.used} limit={usage.apiCalls.limit} />
          </div>
        </motion.div>

        {/* Billing Info */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="p-6 rounded-xl bg-bg-surface border border-border"
        >
          <h3 className="text-lg font-semibold text-text-primary mb-4 flex items-center gap-2">
            <Calendar className="w-5 h-5 text-accent" />
            Billing Information
          </h3>

          <div className="space-y-4">
            <BillingRow label="Next Renewal" value={new Date(subscription.renewalDate).toLocaleDateString()} />
            <BillingRow label="Days Remaining" value={`${daysUntilRenewal} days`} />
            <BillingRow label="Payment Method" value={subscription.paymentMethod} />
            <BillingRow label="Billing Email" value={subscription.billingEmail} />
            <BillingRow label="Started" value={new Date(subscription.startDate).toLocaleDateString()} />
          </div>

          {daysUntilRenewal <= 30 && (
            <div className="mt-4 p-3 rounded-lg bg-warning/10 border border-warning/20">
              <div className="flex items-center gap-2 text-warning">
                <AlertCircle className="w-4 h-4" />
                <span className="text-sm font-medium">Renewal Coming Up</span>
              </div>
              <p className="text-xs text-text-muted mt-1">
                Your subscription renews in {daysUntilRenewal} days.
              </p>
            </div>
          )}
        </motion.div>
      </div>

      {/* Plan Features */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
        className="p-6 rounded-xl bg-bg-surface border border-border"
      >
        <h3 className="text-lg font-semibold text-text-primary mb-4 flex items-center gap-2">
          <Shield className="w-5 h-5 text-accent" />
          Plan Features
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {currentPlan.features.map((feature, index) => (
            <div
              key={index}
              className={cn(
                'flex items-center gap-3 p-3 rounded-lg',
                feature.included ? 'bg-success/5' : 'bg-bg-base opacity-50',
              )}
            >
              {feature.included ? (
                <Check className="w-5 h-5 text-success shrink-0" />
              ) : (
                <X className="w-5 h-5 text-text-muted shrink-0" />
              )}
              <div>
                <p className={cn('text-sm', feature.included ? 'text-text-primary' : 'text-text-muted')}>
                  {feature.name}
                </p>
                {feature.limit && (
                  <p className="text-xs text-text-muted">{feature.limit}</p>
                )}
              </div>
            </div>
          ))}
        </div>
      </motion.div>

      {/* Plan Comparison */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3 }}
        className="p-6 rounded-xl bg-bg-surface border border-border"
      >
        <h3 className="text-lg font-semibold text-text-primary mb-4">
          Compare Plans
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <PlanCard
            name="Starter"
            price={99}
            features={['Up to 50 VMs', '5 hosts', '10 TB storage', 'Email support']}
            isCurrentPlan={false}
          />
          <PlanCard
            name="Professional"
            price={499}
            features={['Unlimited VMs', '20 hosts', '100 TB storage', 'Priority support', 'SSO']}
            isCurrentPlan={true}
          />
          <PlanCard
            name="Enterprise"
            price={null}
            features={['Unlimited everything', 'Custom SLA', 'Dedicated support', 'Custom branding', 'On-premise option']}
            isCurrentPlan={false}
          />
        </div>
      </motion.div>

      {/* Invoices */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.4 }}
        className="p-6 rounded-xl bg-bg-surface border border-border"
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-text-primary flex items-center gap-2">
            <Clock className="w-5 h-5 text-accent" />
            Recent Invoices
          </h3>
          <Button variant="secondary" size="sm">
            View All
          </Button>
        </div>

        <div className="space-y-2">
          <InvoiceRow date="Jan 1, 2026" amount="$499.00" status="paid" />
          <InvoiceRow date="Dec 1, 2025" amount="$499.00" status="paid" />
          <InvoiceRow date="Nov 1, 2025" amount="$499.00" status="paid" />
        </div>
      </motion.div>
    </div>
  );
}

function UsageStat({
  icon,
  label,
  value,
  limit,
}: {
  icon: React.ReactNode;
  label: string;
  value: number | string;
  limit: number | string;
}) {
  const percentage = typeof value === 'number' && typeof limit === 'number'
    ? (value / limit) * 100
    : null;

  return (
    <div className="text-center">
      <div className="text-text-muted mb-1">{icon}</div>
      <p className="text-lg font-bold text-text-primary">{value}</p>
      <p className="text-xs text-text-muted">{typeof limit === 'number' ? `/ ${limit}` : limit} {label}</p>
      {percentage !== null && (
        <div className="mt-2 h-1 rounded-full bg-bg-elevated overflow-hidden">
          <div
            className={cn(
              'h-full rounded-full',
              percentage > 90 ? 'bg-error' : percentage > 70 ? 'bg-warning' : 'bg-success',
            )}
            style={{ width: `${Math.min(percentage, 100)}%` }}
          />
        </div>
      )}
    </div>
  );
}

function BillingRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-sm text-text-muted">{label}</span>
      <span className="text-sm text-text-primary font-medium">{value}</span>
    </div>
  );
}

function PlanCard({
  name,
  price,
  features,
  isCurrentPlan,
}: {
  name: string;
  price: number | null;
  features: string[];
  isCurrentPlan: boolean;
}) {
  return (
    <div
      className={cn(
        'p-5 rounded-xl border transition-all',
        isCurrentPlan
          ? 'bg-accent/5 border-accent/30'
          : 'bg-bg-base border-border hover:border-border-hover',
      )}
    >
      <div className="flex items-center justify-between mb-3">
        <h4 className="font-semibold text-text-primary">{name}</h4>
        {isCurrentPlan && (
          <Badge variant="info">Current</Badge>
        )}
      </div>
      <div className="mb-4">
        {price !== null ? (
          <p className="text-2xl font-bold text-text-primary">
            ${price}<span className="text-sm font-normal text-text-muted">/mo</span>
          </p>
        ) : (
          <p className="text-2xl font-bold text-text-primary">Custom</p>
        )}
      </div>
      <ul className="space-y-2 mb-4">
        {features.map((feature, index) => (
          <li key={index} className="flex items-center gap-2 text-sm text-text-secondary">
            <Check className="w-4 h-4 text-success shrink-0" />
            {feature}
          </li>
        ))}
      </ul>
      {!isCurrentPlan && (
        <Button variant="secondary" className="w-full">
          {price === null ? 'Contact Sales' : 'Upgrade'}
        </Button>
      )}
    </div>
  );
}

function InvoiceRow({
  date,
  amount,
  status,
}: {
  date: string;
  amount: string;
  status: 'paid' | 'pending' | 'failed';
}) {
  const statusConfig = {
    paid: { variant: 'success' as const, label: 'Paid' },
    pending: { variant: 'warning' as const, label: 'Pending' },
    failed: { variant: 'danger' as const, label: 'Failed' },
  };

  return (
    <div className="flex items-center justify-between p-3 rounded-lg bg-bg-base hover:bg-bg-hover transition-colors">
      <div className="flex items-center gap-4">
        <Calendar className="w-4 h-4 text-text-muted" />
        <span className="text-sm text-text-primary">{date}</span>
      </div>
      <div className="flex items-center gap-4">
        <span className="text-sm font-medium text-text-primary">{amount}</span>
        <Badge variant={statusConfig[status].variant}>{statusConfig[status].label}</Badge>
        <Button variant="ghost" size="sm">
          <ExternalLink className="w-4 h-4" />
        </Button>
      </div>
    </div>
  );
}

export default Subscriptions;
