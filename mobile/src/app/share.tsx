import { router, useLocalSearchParams } from 'expo-router';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import {
  KeyboardAvoidingView,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { EmptyState, ErrorState, Pulse, SkeletonBlock } from '@/components/states';
import { LinkPreview } from '@/components/link-preview';
import { ThreadAvatar } from '@/components/thread-avatar';
import { Avatar, haptic, Icon, PressableScale } from '@/components/ui';
import type { Account, MessageAttachment, SharedLink, Thread } from '@/data/types';
import { share, type ShareMode } from '@/share/send';
import { useSharedLink } from '@/share/use-shared-link';
import { matchRank } from '@/share/search';
import { contextGrant, lastUsed, shareSections } from '@/share/sections';
import { isGroup, threadLabel } from '@/share/thread-label';
import { api, cacheAccounts, ensureAccounts, logEngagement, reportError, useAccount, useStore } from '@/state/store';
import { colors } from '@/theme';

/** Wait this long after the last keystroke before searching the server. */
const SEARCH_DEBOUNCE_MS = 150;
const COLUMNS = 4;
const AVATAR = 58;
/** An agent's second line: the project it belongs to, so you know whose agent gets this. */
function OwnerLine({ account }: { account: Account }) {
  const project = useAccount(account.projectId);
  if (account.kind !== 'agent') return null;
  return (
    <Text style={styles.owner} numberOfLines={1}>
      {project ? project.name : 'Tardy'}
    </Text>
  );
}

type Target = { key: string; kind: 'group'; thread: Thread } | { key: string; kind: 'account'; account: Account };

const targetKey = (t: Target) => t.key;

const TargetCell = memo(function TargetCell({
  target,
  label,
  me,
  selected,
  onToggle,
}: {
  target: Target;
  label: string;
  me: string | undefined;
  selected: boolean;
  onToggle: (t: Target) => void;
}) {
  return (
    <PressableScale
      style={styles.cell}
      scaleTo={0.94}
      onPress={() => onToggle(target)}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={target.kind === 'group' ? `Group: ${label}` : label}>
      <View>
        {target.kind === 'group' ? (
          <ThreadAvatar thread={target.thread} me={me} size={AVATAR} background={colors.surface} />
        ) : (
          <Avatar account={target.account} size={AVATAR} />
        )}
        {selected && (
          <View style={styles.check}>
            <Icon name="checkmark" size={11} color={colors.onPrimary} weight="bold" />
          </View>
        )}
      </View>
      <Text
        style={[styles.cellLabel, selected && styles.cellLabelSelected]}
        numberOfLines={target.kind === 'account' && target.account.kind === 'agent' ? 1 : 2}>
        {label}
      </Text>
      {target.kind === 'account' && <OwnerLine account={target.account} />}
    </PressableScale>
  );
});

function GridSkeleton() {
  return (
    <Pulse style={styles.skeleton}>
      {Array.from({ length: 8 }, (_, i) => (
        <View key={i} style={styles.cell}>
          <SkeletonBlock style={{ width: AVATAR, height: AVATAR, borderRadius: AVATAR / 2 }} />
          <SkeletonBlock style={{ width: 52, height: 10 }} />
        </View>
      ))}
    </Pulse>
  );
}

/**
 * The share sheet, and "New message" when opened without a post. Built for speed: the
 * people and groups you talk to most are already on screen, one tap selects, one more
 * sends. Picking two or more people makes a group by default ("Separately" sends a copy
 * to each). Sends to the same people reuse their thread, never a duplicate.
 */
export default function ShareSheet() {
  const { postId, url } = useLocalSearchParams<{ postId?: string; url?: string }>();
  const composing = !postId && !url;
  // A link shared into Tardy (share extension or deep link): register it once, show its card.
  const [link, setLink] = useState<SharedLink | null>(null);
  const [linkError, setLinkError] = useState<string | null>(null);
  useEffect(() => {
    if (!url) return;
    let live = true;
    api
      .createSharedLink(url)
      .then((l) => live && setLink(l))
      .catch((e: unknown) => live && setLinkError(e instanceof Error ? e.message : String(e)));
    return () => {
      live = false;
    };
  }, [url]);
  // Re-read until enrichment settles, so the card fills in while you pick people.
  const { link: enriched } = useSharedLink(link?.id, link);
  const { width: windowWidth } = useWindowDimensions();
  const attachment: MessageAttachment | undefined = postId
    ? { sharedPostId: postId }
    : link
      ? { sharedLinkId: link.id }
      : undefined;
  const insets = useSafeAreaInsets();
  const me = useStore((s) => s.accounts.get('me')?.id);
  const accountsById = useStore((s) => s.accounts);

  const [query, setQuery] = useState('');
  const [threads, setThreads] = useState<Thread[] | null>(null);
  const [people, setPeople] = useState<Account[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Target[]>([]);
  const [mode, setMode] = useState<ShareMode>('group');
  const [note, setNote] = useState('');
  const [groupName, setGroupName] = useState('');
  const [phase, setPhase] = useState<'idle' | 'sending' | 'sent'>('idle');

  const handleOf = useCallback((id: string) => accountsById.get(id)?.handle, [accountsById]);
  const labelOf = useCallback(
    (t: Target) => (t.kind === 'group' ? threadLabel(t.thread, me, handleOf) : t.account.name),
    [me, handleOf],
  );

  const loadGroups = useCallback(async () => {
    try {
      const threads = await api.threads();
      await ensureAccounts(threads.filter(isGroup).flatMap((t) => t.participantIds));
      setThreads(threads);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    // Fetch on mount; loadGroups() sets state only after its request settles.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadGroups();
  }, [loadGroups]);

  useEffect(() => {
    let live = true;
    const timer = setTimeout(
      async () => {
        try {
          const found = await api.searchAccounts(query);
          if (!live) return;
          cacheAccounts(found);
          setPeople(found);
          setError(null);
        } catch (e) {
          if (live) setError(e instanceof Error ? e.message : String(e));
        }
      },
      query ? SEARCH_DEBOUNCE_MS : 0,
    );
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [query]);

  const sections = useMemo(() => {
    if (!threads || !people) return null;
    const used = lastUsed(threads, me);
    const groupTargets = threads
      .filter(isGroup)
      .map((thread): Target => ({ key: `g:${thread.id}`, kind: 'group', thread }))
      .filter((t) => !query.trim() || matchRank({ handle: labelOf(t), name: labelOf(t) }, query) !== null);
    // Picked targets stay visible while the query narrows, so you can see and undo them.
    const shownPeople = new Set(people.map((a) => a.id));
    const pinnedPeople = selected.flatMap((t) => (t.kind === 'account' && !shownPeople.has(t.account.id) ? [t.account] : []));
    const pinnedGroups = selected.filter((t) => t.kind === 'group' && !groupTargets.some((g) => g.key === t.key));
    const candidates = [
      ...[...pinnedPeople, ...people].map((account) => ({
        target: { key: `a:${account.id}`, kind: 'account' as const, account },
        kind: account.kind,
        ownedByViewer: account.ownedByViewer,
        lastUsedMs: used.get(account.id),
      })),
      ...[...pinnedGroups, ...groupTargets].map((target) => ({
        target,
        kind: 'group' as const,
        lastUsedMs: used.get(target.key),
      })),
    ];
    return shareSections(candidates, { byRecency: !query.trim() }).map((section) => ({
      title: section.title,
      items: section.items.map((c) => c.target),
    }));
  }, [threads, people, query, selected, labelOf, me]);

  const selectedKeys = useMemo(() => new Set(selected.map(targetKey)), [selected]);
  const pickedPeople = selected.flatMap((t) => (t.kind === 'account' ? [t.account] : []));
  const pickedGroups = selected.flatMap((t) => (t.kind === 'group' ? [t.thread] : []));
  // A new chat with several people is always a group; only shares offer "Separately".
  const offersGroup = pickedPeople.length > 1;
  const effectiveMode: ShareMode = offersGroup && !composing ? mode : 'group';

  const grant = contextGrant(
    selected.flatMap((t) => (t.kind === 'account' && t.account.kind === 'agent' ? [t.account.handle] : [])),
    postId ? 'post' : url ? 'link' : null,
  );

  const toggle = useCallback((t: Target) => {
    haptic.selection();
    setSelected((prev) => (prev.some((s) => s.key === t.key) ? prev.filter((s) => s.key !== t.key) : [...prev, t]));
  }, []);

  // A link share can't go out until the server has registered the link.
  const waitingForLink = !!url && !link;

  const send = async () => {
    if (selected.length === 0 || phase !== 'idle' || waitingForLink) return;
    setPhase('sending');
    const result = await share(api, {
      recipients: pickedPeople,
      threads: pickedGroups,
      mode: effectiveMode,
      attachment,
      note: composing ? '' : note,
      title: groupName,
    });
    if (result.failed.length > 0) {
      const who = result.failed.map((f) => f.participantIds.map(handleOf).filter(Boolean).join(', ')).join('; ');
      reportError(`Couldn't send to ${who}: ${result.failed[0].error}`);
    }
    if (result.sent.length === 0) {
      setPhase('idle');
      return;
    }
    haptic.impact();
    if (composing) {
      router.replace({
        pathname: '/messages/[threadId]',
        params: { threadId: result.sent[0].id },
      });
      return;
    }
    if (postId) logEngagement({ type: 'share_via_dm', postId });
    setPhase('sent');
    setTimeout(() => router.back(), 450);
  };

  const shareElsewhere = async () => {
    if (url) {
      await Share.share({ message: link?.canonicalUrl ?? url });
      return;
    }
    if (!postId) return;
    try {
      const post = await api.post(postId);
      await ensureAccounts([post.authorId]);
      const handle = handleOf(post.authorId);
      const r = await Share.share({
        message: `${post.caption}\n\n— @${handle} on Tardy`,
      });
      if (r.action === Share.sharedAction) logEngagement({ type: 'share', postId });
    } catch (e) {
      reportError(`Couldn't open sharing: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const count = pickedPeople.length + pickedGroups.length;
  const newGroup = effectiveMode === 'group' && pickedPeople.length > 1;
  const actionLabel =
    phase === 'sent'
      ? 'Sent'
      : composing
        ? newGroup
          ? 'Start group chat'
          : 'Chat'
        : newGroup
          ? 'Send to new group'
          : count > 1
            ? `Send to ${count}`
            : 'Send';

  return (
    <KeyboardAvoidingView style={styles.screen} behavior="padding">
      <Text style={styles.title} accessibilityRole="header">
        {composing ? 'New message' : 'Share'}
      </Text>
      {url ? (
        <View style={styles.linkHeader}>
          <LinkPreview url={url} link={enriched ?? link} error={linkError} width={windowWidth - 32} compact />
        </View>
      ) : null}
      <View style={styles.search}>
        <Icon name="magnifyingglass" size={16} color={colors.textTertiary} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search agents and people"
          placeholderTextColor={colors.textTertiary}
          style={styles.searchInput}
          autoCorrect={false}
          autoCapitalize="none"
          autoFocus={composing}
          clearButtonMode="while-editing"
          returnKeyType="search"
        />
      </View>

      {error && !sections ? (
        <ErrorState
          message="Couldn't find anyone to share with. They're probably all on break."
          detail={error}
          onRetry={loadGroups}
        />
      ) : !sections ? (
        <GridSkeleton />
      ) : sections.length === 0 ? (
        query ? (
          <EmptyState
            icon="magnifyingglass"
            title="Nobody by that name"
            message="No agent or person matches. Check the spelling."
          />
        ) : (
          <EmptyState icon="person.2" title="No one here yet" message="Follow some agents and they'll show up here." />
        )
      ) : (
        // Wrapped and clipped: an iOS form sheet otherwise lays its first scroll view out from the
        // sheet's top edge, under the title and search field.
        <View style={styles.scroll}>
          <ScrollView
            style={styles.scroll}
            contentInsetAdjustmentBehavior="never"
            contentContainerStyle={styles.grid}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag">
            {sections.map((section) => (
              <View key={section.title}>
                <Text style={styles.sectionTitle} accessibilityRole="header">
                  {section.title}
                </Text>
                <View style={styles.row}>
                  {section.items.map((item) => (
                    <TargetCell
                      key={item.key}
                      target={item}
                      label={labelOf(item)}
                      me={me}
                      selected={selectedKeys.has(item.key)}
                      onToggle={toggle}
                    />
                  ))}
                </View>
              </View>
            ))}
          </ScrollView>
        </View>
      )}

      {(selected.length > 0 || !composing) && (
        <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 12) }]}>
          {selected.length === 0 ? (
            !composing && (
              <PressableScale
                style={styles.elsewhere}
                onPress={shareElsewhere}
                accessibilityRole="button"
                accessibilityLabel="Share outside Tardy">
                <Icon name="square.and.arrow.up" size={18} color={colors.text} />
                <Text style={styles.elsewhereText}>Share outside Tardy</Text>
              </PressableScale>
            )
          ) : (
            <>
              {offersGroup && !composing && (
                <View style={styles.modeRow} accessibilityRole="radiogroup">
                  {(['group', 'separately'] as const).map((m) => (
                    <Pressable
                      key={m}
                      onPress={() => {
                        haptic.selection();
                        setMode(m);
                      }}
                      style={[styles.modeChip, mode === m && styles.modeChipOn]}
                      accessibilityRole="radio"
                      accessibilityState={{ checked: mode === m }}>
                      <Text style={[styles.modeText, mode === m && styles.modeTextOn]}>
                        {m === 'group' ? 'Group chat' : 'Separately'}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              )}
              {offersGroup && effectiveMode === 'group' && (
                <TextInput
                  value={groupName}
                  onChangeText={setGroupName}
                  placeholder="Name the group (optional)"
                  placeholderTextColor={colors.textTertiary}
                  style={styles.input}
                  maxLength={60}
                />
              )}
              {grant && (
                <View style={styles.grant} accessibilityRole="text">
                  <Icon name="bolt.fill" size={12} color={colors.primary} />
                  <Text style={styles.grantText}>{grant}</Text>
                </View>
              )}
              {!composing && (
                <TextInput
                  value={note}
                  onChangeText={setNote}
                  placeholder="Write a message…"
                  placeholderTextColor={colors.textTertiary}
                  style={styles.input}
                  maxLength={1000}
                />
              )}
              <PressableScale
                style={[styles.send, phase === 'sent' && styles.sendDone]}
                onPress={send}
                disabled={phase !== 'idle' || waitingForLink}
                accessibilityRole="button"
                accessibilityLabel={actionLabel}
                accessibilityState={{
                  busy: phase === 'sending',
                  disabled: phase !== 'idle',
                }}>
                {phase === 'sent' && <Icon name="checkmark" size={15} color={colors.onPrimary} weight="bold" />}
                <Text style={styles.sendText}>{phase === 'sending' ? 'Sending…' : actionLabel}</Text>
              </PressableScale>
            </>
          )}
        </View>
      )}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface },
  title: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '800',
    textAlign: 'center',
    paddingTop: 18,
    paddingBottom: 10,
  },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 16,
    paddingHorizontal: 12,
    height: 38,
    borderRadius: 999,
    backgroundColor: colors.elevated,
  },
  searchInput: { flex: 1, color: colors.text, fontSize: 15 },
  sectionTitle: {
    color: colors.textSecondary,
    fontSize: 12.5,
    fontWeight: '700',
    paddingHorizontal: 10,
    paddingTop: 8,
    paddingBottom: 2,
  },
  row: { flexDirection: 'row', flexWrap: 'wrap' },
  owner: { color: colors.textTertiary, fontSize: 10.5, marginTop: -4, maxWidth: 84 },
  grant: { flexDirection: 'row', gap: 6, alignItems: 'flex-start' },
  grantText: { flex: 1, color: colors.textSecondary, fontSize: 12.5, lineHeight: 17 },
  scroll: { flex: 1, overflow: 'hidden' },
  linkHeader: { marginHorizontal: 16, marginBottom: 10 },
  grid: { paddingHorizontal: 8, paddingTop: 14, paddingBottom: 16 },
  skeleton: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 8,
    paddingTop: 14,
    rowGap: 14,
  },
  cell: {
    width: `${100 / COLUMNS}%`,
    alignItems: 'center',
    gap: 6,
    paddingVertical: 6,
  },
  cellLabel: {
    color: colors.textSecondary,
    fontSize: 11.5,
    textAlign: 'center',
    paddingHorizontal: 4,
  },
  cellLabelSelected: { color: colors.text, fontWeight: '700' },
  check: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
    borderWidth: 2.5,
    borderColor: colors.surface,
  },
  footer: {
    gap: 10,
    paddingHorizontal: 16,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.separator,
    backgroundColor: colors.surface,
  },
  elsewhere: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 44,
    borderRadius: 12,
    backgroundColor: colors.elevated,
  },
  elsewhereText: { color: colors.text, fontSize: 15, fontWeight: '600' },
  modeRow: { flexDirection: 'row', gap: 8 },
  modeChip: {
    flex: 1,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.elevated,
  },
  modeChipOn: { backgroundColor: colors.text },
  modeText: { color: colors.textSecondary, fontSize: 13.5, fontWeight: '600' },
  modeTextOn: { color: colors.bg },
  input: {
    height: 40,
    paddingHorizontal: 14,
    borderRadius: 12,
    backgroundColor: colors.elevated,
    color: colors.text,
    fontSize: 15,
  },
  send: {
    flexDirection: 'row',
    gap: 6,
    height: 46,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
  },
  sendDone: { opacity: 0.85 },
  sendText: { color: colors.onPrimary, fontSize: 15.5, fontWeight: '800' },
});
