import { router, Stack } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { Avatar, Icon } from '@/components/ui';
import { openWebCheckout } from '@/config';
import { handleProblem, normalizeHandle } from '@/auth/handle';
import { TardyApiError } from '@/data/api';
import { normalizeProfilePatch, PROFILE_LIMITS, profileProblem, type ProfilePatch } from '@/data/profile';
import { api, cacheAccounts, useAccount } from '@/state/store';
import { colors, radius } from '@/theme';

/** Edit your name, @handle, and bio. Saves only what changed; the server re-validates. */
export default function EditProfileScreen() {
  const me = useAccount('me');
  const [name, setName] = useState(me?.name ?? '');
  const [handle, setHandle] = useState(me?.handle ?? '');
  const [bio, setBio] = useState(me?.bio ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!me) return <ActivityIndicator color={colors.textSecondary} style={{ marginTop: 40 }} />;

  const nextHandle = normalizeHandle(handle);
  const patch: ProfilePatch = normalizeProfilePatch({
    ...(name.trim() !== me.name && { name }),
    ...(bio.trim() !== me.bio && { bio }),
  });
  const handleChanged = nextHandle !== me.handle;
  const problem = (handleChanged ? handleProblem(nextHandle) : null) ?? profileProblem(patch);
  const dirty = handleChanged || Object.keys(patch).length > 0;

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      // Handle first: it's the step that can collide with someone else's.
      if (handleChanged) cacheAccounts([await api.setHandle(nextHandle)]);
      if (Object.keys(patch).length > 0) cacheAccounts([await api.updateProfile(patch)]);
      router.back();
    } catch (e) {
      setError(
        e instanceof TardyApiError && (e.code === 'conflict' || e.code === 'invalid')
          ? e.message
          : `Couldn't save: ${e instanceof Error ? e.message : String(e)}`,
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <KeyboardAvoidingView style={styles.screen} behavior="padding">
      <Stack.Screen
        options={{
          headerRight: () => (
            <Pressable onPress={save} disabled={!dirty || !!problem || saving} hitSlop={10}>
              {saving ? (
                <ActivityIndicator color={colors.primary} />
              ) : (
                <Text style={[styles.save, (!dirty || !!problem) && styles.saveDisabled]}>Save</Text>
              )}
            </Pressable>
          ),
        }}
      />
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <View style={styles.avatar}>
          <Avatar account={me} size={88} />
        </View>

        <Field label="Name" count={`${name.trim().length}/${PROFILE_LIMITS.name}`}>
          <TextInput
            value={name}
            onChangeText={setName}
            style={styles.input}
            placeholder="Your name"
            placeholderTextColor={colors.textTertiary}
            maxLength={PROFILE_LIMITS.name + 10}
            autoCorrect={false}
            textContentType="name"
          />
        </Field>

        <Field label="Handle">
          <View style={styles.handleRow}>
            <Text style={styles.at}>@</Text>
            <TextInput
              value={handle}
              onChangeText={setHandle}
              style={[styles.input, styles.handleInput]}
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="off"
              textContentType="none"
            />
          </View>
        </Field>

        <Field label="Bio" count={`${bio.trim().length}/${PROFILE_LIMITS.bio}`}>
          <TextInput
            value={bio}
            onChangeText={setBio}
            style={[styles.input, styles.bio]}
            placeholder="What are your agents up to?"
            placeholderTextColor={colors.textTertiary}
            multiline
            maxLength={PROFILE_LIMITS.bio + 20}
          />
        </Field>

        {(problem || error) && <Text style={styles.error}>{problem ?? error}</Text>}

        <View style={styles.field}>
          <Text style={styles.label}>Upgrades</Text>
          <Pressable
            style={({ pressed }) => [styles.upgrade, pressed && styles.upgradePressed]}
            onPress={() => void openWebCheckout('boost')}
            accessibilityRole="link"
            accessibilityHint="Opens checkout on the Tardy website">
            <View style={styles.upgradeRing} />
            <View style={styles.upgradeText}>
              <Text style={styles.upgradeTitle}>Story boost</Text>
              <Text style={styles.upgradeSub}>A red ring on your story, and the front of everyone&apos;s tray.</Text>
            </View>
            <Icon name="arrow.up.right" size={14} color={colors.textSecondary} weight="bold" />
          </Pressable>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Field({ label, count, children }: { label: string; count?: string; children: React.ReactNode }) {
  return (
    <View style={styles.field}>
      <View style={styles.labelRow}>
        <Text style={styles.label}>{label}</Text>
        {count && <Text style={styles.count}>{count}</Text>}
      </View>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  body: { padding: 16, gap: 18 },
  avatar: { alignItems: 'center', paddingVertical: 8 },
  field: { gap: 6 },
  labelRow: { flexDirection: 'row', justifyContent: 'space-between' },
  label: { color: colors.textSecondary, fontSize: 13, fontWeight: '700' },
  count: { color: colors.textTertiary, fontSize: 12, fontVariant: ['tabular-nums'] },
  input: {
    color: colors.text,
    fontSize: 16,
    backgroundColor: colors.surface,
    borderRadius: radius.media,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  handleRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, borderRadius: radius.media },
  at: { color: colors.textSecondary, fontSize: 16, paddingLeft: 14 },
  handleInput: { flex: 1, paddingLeft: 2 },
  bio: { minHeight: 96, textAlignVertical: 'top' },
  save: { color: colors.primary, fontSize: 16, fontWeight: '800' },
  saveDisabled: { color: colors.textTertiary },
  error: { color: colors.alarm, fontSize: 13 },
  upgrade: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderRadius: radius.media,
    backgroundColor: colors.surface,
  },
  upgradePressed: { opacity: 0.7 },
  upgradeRing: { width: 30, height: 30, borderRadius: 15, borderWidth: 3, borderColor: colors.alarm },
  upgradeText: { flex: 1, gap: 2 },
  upgradeTitle: { color: colors.text, fontSize: 15, fontWeight: '700' },
  upgradeSub: { color: colors.textSecondary, fontSize: 12.5 },
});
