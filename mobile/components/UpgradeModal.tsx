import React from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Linking,
  ActivityIndicator,
  ScrollView,
} from 'react-native';
import { billing, PRICE_IDS } from '../services/api';

const ORANGE = '#FF6B2B';
const DARK   = '#1A1A1A';
const GREEN  = '#27AE60';

// ── Plan definitions ──────────────────────────────────────────────────────────
const OWNER_PLANS = [
  {
    id:       'starter',
    name:     'Starter',
    price:    '$39',
    interval: '/mo',
    price_id: PRICE_IDS.owner_starter,
    features: [
      '5 active job posts',
      'View worker contact details',
      'AI match engine',
      'Priority support',
    ],
    highlight: false,
  },
  {
    id:       'growth',
    name:     'Growth',
    price:    '$99',
    interval: '/mo',
    price_id: PRICE_IDS.owner_growth,
    features: [
      'Unlimited job posts',
      'Everything in Starter',
      'WhatsApp job alerts',
      'Featured listings',
      'Analytics dashboard',
    ],
    highlight: true,
  },
];

const WORKER_PLANS = [
  {
    id:       'worker_boost',
    name:     'Boost',
    price:    '$7',
    interval: '/mo',
    price_id: PRICE_IDS.worker_boost,
    features: [
      'Priority in search results',
      'Verified badge on profile',
      'WhatsApp job alerts',
      'Get seen before free profiles',
    ],
    highlight: true,
  },
];

interface UpgradeModalProps {
  visible:     boolean;
  onClose:     () => void;
  userType:    'owner' | 'worker';
  /** Optional message shown at top — from the 402 error */
  message?:    string;
  /** Which feature was blocked — shown as context */
  feature?:    string;
}

export default function UpgradeModal({
  visible,
  onClose,
  userType,
  message,
  feature,
}: UpgradeModalProps) {
  const [loading, setLoading] = React.useState<string | null>(null);
  const plans = userType === 'owner' ? OWNER_PLANS : WORKER_PLANS;

  async function handleUpgrade(plan: typeof OWNER_PLANS[0]) {
    setLoading(plan.id);
    try {
      const successUrl = 'https://rasoilink.com/success?plan=' + plan.id;
      const cancelUrl  = 'https://rasoilink.com/cancel';

      const res = await billing.checkout(
        plan.price_id,
        'subscription',
        successUrl,
        cancelUrl,
      );

      const url = res.data?.data?.url;
      if (url) {
        await Linking.openURL(url);
        onClose();
      }
    } catch (e: any) {
      console.error('Checkout error:', e?.response?.data ?? e.message);
    } finally {
      setLoading(null);
    }
  }

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      <View style={s.overlay}>
        <View style={s.sheet}>

          {/* Header */}
          <View style={s.header}>
            <TouchableOpacity style={s.closeBtn} onPress={onClose}>
              <Text style={s.closeBtnText}>✕</Text>
            </TouchableOpacity>
            <Text style={s.headerEmoji}>🚀</Text>
            <Text style={s.headerTitle}>Upgrade RasoiLink</Text>
            <Text style={s.headerSub}>
              {feature
                ? `Unlock ${feature} and more`
                : 'Unlock the full platform'}
            </Text>
          </View>

          {/* Gate message if passed */}
          {message && (
            <View style={s.messageBanner}>
              <Text style={s.messageText}>{message}</Text>
            </View>
          )}

          <ScrollView contentContainerStyle={s.plansContainer} showsVerticalScrollIndicator={false}>

            {plans.map((plan) => (
              <View
                key={plan.id}
                style={[s.planCard, plan.highlight && s.planCardHighlight]}
              >
                {plan.highlight && (
                  <View style={s.popularBadge}>
                    <Text style={s.popularBadgeText}>Most Popular</Text>
                  </View>
                )}

                <View style={s.planHeader}>
                  <View>
                    <Text style={s.planName}>{plan.name}</Text>
                    <View style={s.priceRow}>
                      <Text style={s.planPrice}>{plan.price}</Text>
                      <Text style={s.planInterval}>{plan.interval}</Text>
                    </View>
                  </View>
                </View>

                <View style={s.featureList}>
                  {plan.features.map((f) => (
                    <View key={f} style={s.featureRow}>
                      <Text style={s.featureCheck}>✓</Text>
                      <Text style={s.featureText}>{f}</Text>
                    </View>
                  ))}
                </View>

                <TouchableOpacity
                  style={[
                    s.upgradeBtn,
                    plan.highlight && s.upgradeBtnHighlight,
                    loading === plan.id && s.upgradeBtnDisabled,
                  ]}
                  onPress={() => handleUpgrade(plan)}
                  disabled={!!loading}
                >
                  {loading === plan.id
                    ? <ActivityIndicator color="#fff" />
                    : <Text style={s.upgradeBtnText}>
                        Get {plan.name} — {plan.price}{plan.interval}
                      </Text>
                  }
                </TouchableOpacity>
              </View>
            ))}

            {/* Free plan note */}
            <Text style={s.freeNote}>
              Your free plan stays active until you upgrade.{'\n'}
              Cancel anytime — no contracts.
            </Text>

          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '90%',
    overflow: 'hidden',
  },
  header: {
    backgroundColor: DARK,
    padding: 24,
    paddingTop: 28,
    alignItems: 'center',
  },
  closeBtn: {
    position: 'absolute',
    top: 20,
    right: 20,
    padding: 8,
  },
  closeBtnText: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 18,
  },
  headerEmoji: {
    fontSize: 36,
    marginBottom: 8,
  },
  headerTitle: {
    color: '#fff',
    fontSize: 22,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  headerSub: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 14,
    textAlign: 'center',
  },
  messageBanner: {
    backgroundColor: '#FFF3E0',
    borderLeftWidth: 4,
    borderLeftColor: ORANGE,
    padding: 12,
    margin: 16,
    marginBottom: 0,
    borderRadius: 8,
  },
  messageText: {
    color: '#E65100',
    fontSize: 13,
    lineHeight: 18,
  },
  plansContainer: {
    padding: 16,
    paddingBottom: 40,
  },
  planCard: {
    borderWidth: 1.5,
    borderColor: '#E0E0E0',
    borderRadius: 16,
    padding: 20,
    marginBottom: 12,
    backgroundColor: '#fff',
    position: 'relative',
  },
  planCardHighlight: {
    borderColor: ORANGE,
    borderWidth: 2,
  },
  popularBadge: {
    position: 'absolute',
    top: -12,
    alignSelf: 'center',
    backgroundColor: ORANGE,
    paddingHorizontal: 16,
    paddingVertical: 4,
    borderRadius: 12,
  },
  popularBadgeText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '700',
  },
  planHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 16,
    marginTop: 4,
  },
  planName: {
    fontSize: 20,
    fontWeight: 'bold',
    color: DARK,
    marginBottom: 4,
  },
  priceRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 2,
  },
  planPrice: {
    fontSize: 32,
    fontWeight: 'bold',
    color: ORANGE,
  },
  planInterval: {
    fontSize: 14,
    color: '#888',
    marginLeft: 2,
  },
  featureList: {
    marginBottom: 16,
    gap: 8,
  },
  featureRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  featureCheck: {
    color: GREEN,
    fontSize: 16,
    fontWeight: 'bold',
    width: 20,
  },
  featureText: {
    fontSize: 14,
    color: '#444',
    flex: 1,
  },
  upgradeBtn: {
    backgroundColor: DARK,
    padding: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  upgradeBtnHighlight: {
    backgroundColor: ORANGE,
  },
  upgradeBtnDisabled: {
    opacity: 0.6,
  },
  upgradeBtnText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: 'bold',
  },
  freeNote: {
    textAlign: 'center',
    color: '#999',
    fontSize: 12,
    lineHeight: 18,
    marginTop: 8,
  },
});
