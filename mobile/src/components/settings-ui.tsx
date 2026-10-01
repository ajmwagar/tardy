import type { SFSymbol } from 'expo-symbols';
import type { ReactNode } from 'react';
import { ActionSheetIOS, StyleSheet, Switch, Text, View } from 'react-native';

import { colors, radius, type } from '@/theme';

import { Hairline, haptic, Icon, PressableScale } from './ui';

/** A titled group of rows on a card, like Instagram's and Discord's settings. */
export function SettingsSection({ title, footer, children }: { title?: string; footer?: string; children: ReactNode }) {
  return (
    <View style={styles.section}>
      {title ? <Text style={styles.sectionTitle}>{title}</Text> : null}
      <View style={styles.card}>{children}</View>
      {footer ? <Text style={styles.footer}>{footer}</Text> : null}
    </View>
  );
}

type RowBase = { icon: SFSymbol; title: string; subtitle?: string; iconColor?: string; destructive?: boolean; last?: boolean };

/** A row that navigates (chevron), opens the web (arrow), or just acts. Shows a current value on the right. */
export function SettingsRow({
  icon,
  title,
  subtitle,
  value,
  onPress,
  external = false,
  iconColor,
  destructive = false,
  last = false,
}: RowBase & { value?: string; onPress: () => void; external?: boolean }) {
  return (
    <>
      <PressableScale style={styles.row} scaleTo={0.985} onPress={onPress} accessibilityRole="button" accessibilityLabel={value ? `${title}, ${value}` : title}>
        <Icon name={icon} size={20} color={destructive ? colors.alarm : (iconColor ?? colors.text)} />
        <View style={styles.text}>
          <Text style={[styles.title, destructive && styles.destructive]}>{title}</Text>
          {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
        </View>
        {value ? (
          <Text style={styles.value} numberOfLines={1}>
            {value}
          </Text>
        ) : null}
        {!destructive && <Icon name={external ? 'arrow.up.right' : 'chevron.right'} size={13} color={colors.textTertiary} weight="bold" />}
      </PressableScale>
      {!last && <Hairline />}
    </>
  );
}

/** A row with an on/off switch. */
export function SettingsToggle({
  icon,
  title,
  subtitle,
  value,
  onChange,
  iconColor,
  last = false,
}: RowBase & { value: boolean; onChange: (next: boolean) => void }) {
  return (
    <>
      <View style={styles.row} accessible accessibilityRole="switch" accessibilityLabel={title} accessibilityState={{ checked: value }}>
        <Icon name={icon} size={20} color={iconColor ?? colors.text} />
        <View style={styles.text}>
          <Text style={styles.title}>{title}</Text>
          {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
        </View>
        <Switch
          value={value}
          onValueChange={(next) => {
            haptic.selection();
            onChange(next);
          }}
          trackColor={{ true: colors.primary, false: colors.elevated }}
        />
      </View>
      {!last && <Hairline />}
    </>
  );
}

/** A row whose value is one of a few labelled choices, picked from a sheet. */
export function SettingsChoice<K extends string>({
  icon,
  title,
  subtitle,
  value,
  labels,
  onChange,
  iconColor,
  last = false,
}: RowBase & { value: K; labels: Record<K, string>; onChange: (next: K) => void }) {
  const keys = Object.keys(labels) as K[];
  const pick = () =>
    ActionSheetIOS.showActionSheetWithOptions(
      { title, message: subtitle, options: [...keys.map((k) => (k === value ? `✓ ${labels[k]}` : labels[k])), 'Cancel'], cancelButtonIndex: keys.length },
      (i) => {
        if (i < keys.length && keys[i] !== value) {
          haptic.selection();
          onChange(keys[i]);
        }
      },
    );
  return <SettingsRow icon={icon} title={title} subtitle={subtitle} value={labels[value]} onPress={pick} iconColor={iconColor} last={last} />;
}

const styles = StyleSheet.create({
  section: { gap: 8 },
  sectionTitle: { ...type.tiny, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.6, paddingHorizontal: 4 },
  card: { backgroundColor: colors.surface, borderRadius: radius.card, overflow: 'hidden' },
  footer: { color: colors.textTertiary, fontSize: 12.5, lineHeight: 17, paddingHorizontal: 4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 13, minHeight: 50 },
  text: { flex: 1, gap: 2 },
  title: { color: colors.text, fontSize: 15, fontWeight: '600' },
  destructive: { color: colors.alarm },
  subtitle: { color: colors.textSecondary, fontSize: 12.5, lineHeight: 17 },
  value: { color: colors.textSecondary, fontSize: 14, maxWidth: 150 },
});
