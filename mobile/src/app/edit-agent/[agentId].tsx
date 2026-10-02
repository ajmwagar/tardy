import { router, Stack, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { handleProblem, normalizeHandle } from "@/auth/handle";
import { Avatar } from "@/components/ui";
import { TardyApiError } from "@/data/api";
import { normalizeProfilePatch, profileProblem } from "@/data/profile";
import { api, cacheAccounts, ensureAccounts, useAccount } from "@/state/store";
import { colors, radius } from "@/theme";

export default function EditAgentScreen() {
  const { agentId } = useLocalSearchParams<{ agentId: string }>();
  const cached = useAccount(agentId);
  const [name, setName] = useState(cached?.name ?? "");
  const [handle, setHandle] = useState(cached?.handle ?? "");
  const [bio, setBio] = useState(cached?.bio ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!cached) void ensureAccounts([agentId]);
  }, [agentId, cached]);
  useEffect(() => {
    if (cached) {
      setName(cached.name);
      setHandle(cached.handle);
      setBio(cached.bio);
    }
  }, [cached]);

  if (!cached)
    return (
      <ActivityIndicator
        color={colors.textSecondary}
        style={{ marginTop: 40 }}
      />
    );
  const nextHandle = normalizeHandle(handle);
  const patch = normalizeProfilePatch({
    ...(name.trim() !== cached.name && { name }),
    ...(bio.trim() !== cached.bio && { bio }),
  });
  const handleChanged = nextHandle !== cached.handle;
  const problem =
    (handleChanged ? handleProblem(nextHandle) : null) ?? profileProblem(patch);
  const dirty = handleChanged || Object.keys(patch).length > 0;

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      cacheAccounts([
        await api.updateAgentProfile(agentId, {
          ...patch,
          ...(handleChanged && { handle: nextHandle }),
        }),
      ]);
      router.back();
    } catch (reason) {
      setError(
        reason instanceof TardyApiError
          ? reason.message
          : `Couldn't save: ${reason instanceof Error ? reason.message : String(reason)}`,
      );
    } finally {
      setSaving(false);
    }
  };
  const generate = async () => {
    setSaving(true);
    setError(null);
    try {
      cacheAccounts([await api.generateAgentAvatar(agentId)]);
    } catch (reason) {
      setError(
        `Couldn't generate picture: ${reason instanceof Error ? reason.message : String(reason)}`,
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <KeyboardAvoidingView style={styles.screen} behavior="padding">
      <Stack.Screen
        options={{
          title: "Edit agent",
          headerRight: () => (
            <Pressable
              onPress={save}
              disabled={!dirty || !!problem || saving}
              hitSlop={12}
            >
              <Text
                style={[styles.save, (!dirty || !!problem) && styles.disabled]}
              >
                Save
              </Text>
            </Pressable>
          ),
        }}
      />
      <ScrollView
        contentContainerStyle={styles.body}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.avatar}>
          <Avatar account={cached} size={92} />
          <Pressable onPress={generate} disabled={saving}>
            <Text style={styles.generate}>Generate new picture</Text>
          </Pressable>
        </View>
        <Field label="Name">
          <TextInput
            value={name}
            onChangeText={setName}
            style={styles.input}
            maxLength={80}
            placeholderTextColor={colors.textTertiary}
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
            />
          </View>
        </Field>
        <Field label="Bio">
          <TextInput
            value={bio}
            onChangeText={setBio}
            style={[styles.input, styles.bio]}
            multiline
            maxLength={500}
            placeholder="What does this agent do?"
            placeholderTextColor={colors.textTertiary}
          />
        </Field>
        <Text style={styles.note}>
          Renaming is safe. Posts, chats, follows, and ownership use this
          agent’s permanent ID—not its handle.
        </Text>
        {(problem || error) && (
          <Text style={styles.error}>{problem ?? error}</Text>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      {children}
    </View>
  );
}
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  body: { padding: 16, gap: 18 },
  avatar: { alignItems: "center", gap: 10 },
  field: { gap: 6 },
  label: { color: colors.textSecondary, fontSize: 13, fontWeight: "700" },
  input: {
    color: colors.text,
    fontSize: 16,
    backgroundColor: colors.surface,
    borderRadius: radius.media,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  handleRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.surface,
    borderRadius: radius.media,
  },
  at: { color: colors.textSecondary, fontSize: 16, paddingLeft: 14 },
  handleInput: { flex: 1, paddingLeft: 2 },
  bio: { minHeight: 100, textAlignVertical: "top" },
  save: { color: colors.primary, fontSize: 16, fontWeight: "800" },
  disabled: { color: colors.textTertiary },
  generate: { color: colors.primary, fontWeight: "700" },
  note: { color: colors.textTertiary, fontSize: 12.5, lineHeight: 18 },
  error: { color: colors.alarm, fontSize: 13 },
});
