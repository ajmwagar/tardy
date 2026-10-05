import { Image } from 'expo-image';
import { useState } from 'react';
import { FlatList, Modal, PanResponder, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { ConversationAttachment } from '@/messages/attachment-index';
import { colors } from '@/theme';
import { MessageAttachment } from './message-attachment';

export function ConversationAttachments({ items, onClose, onShowMessage }: {
  items: ConversationAttachment[]; onClose: () => void; onShowMessage: (id: string) => void;
}) {
  const insets = useSafeAreaInsets();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selectedIndex = items.findIndex((item) => item.id === selectedId);
  const selected = items[selectedIndex];
  const swipe = PanResponder.create({
    onMoveShouldSetPanResponder: (_, gesture) => selected?.media.type === 'image' && Math.abs(gesture.dx) > 20 && Math.abs(gesture.dx) > Math.abs(gesture.dy),
    onPanResponderRelease: (_, gesture) => {
      if (Math.abs(gesture.dx) < 50) return;
      const next = selectedIndex + (gesture.dx < 0 ? 1 : -1);
      if (items[next]) setSelectedId(items[next].id);
    },
  });
  const close = () => { setSelectedId(null); onClose(); };
  return (
    <Modal animationType="slide" onRequestClose={close}>
      <View style={[styles.screen, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        <View style={styles.header}>
          <Text style={styles.title}>Media & files</Text>
          <Pressable onPress={close} accessibilityRole="button"><Text style={styles.action}>Done</Text></Pressable>
        </View>
        {selected ? (
          <View style={styles.preview}>
            <View style={styles.header}>
              <Pressable onPress={() => setSelectedId(null)}><Text style={styles.action}>All attachments</Text></Pressable>
              <Text style={styles.muted}>{selectedIndex + 1} / {items.length}</Text>
            </View>
            {selected.media.type === 'image' ? (
              <View style={styles.photo} {...swipe.panHandlers}>
                <Image source={selected.media.url} style={styles.photo} contentFit="contain" accessibilityLabel={selected.media.altText ?? 'Shared photo'} />
              </View>
            ) : <MessageAttachment key={selected.id} media={selected.media} />}
            <Text style={styles.text}>{selected.media.fileName ?? selected.media.altText ?? selected.media.type}</Text>
            <View style={styles.header}>
              <Pressable disabled={selectedIndex === 0} onPress={() => setSelectedId(items[selectedIndex - 1].id)} accessibilityLabel="Previous attachment"><Text style={[styles.action, selectedIndex === 0 && styles.disabled]}>Previous</Text></Pressable>
              <Pressable onPress={() => onShowMessage(selected.messageId)}><Text style={styles.action}>Show in chat</Text></Pressable>
              <Pressable disabled={selectedIndex === items.length - 1} onPress={() => setSelectedId(items[selectedIndex + 1].id)} accessibilityLabel="Next attachment"><Text style={[styles.action, selectedIndex === items.length - 1 && styles.disabled]}>Next</Text></Pressable>
            </View>
          </View>
        ) : (
          <FlatList
            data={items} numColumns={3} keyExtractor={(item) => item.id}
            ListHeaderComponent={<Text style={styles.muted}>Attachments in loaded messages</Text>}
            ListEmptyComponent={<Text style={styles.text}>No attachments yet.</Text>}
            contentContainerStyle={styles.grid}
            renderItem={({ item }) => (
              <Pressable style={styles.tile} onPress={() => setSelectedId(item.id)} accessibilityRole="button" accessibilityLabel={`Preview ${item.media.fileName ?? item.media.type}`}>
                {item.media.type === 'image' ? <Image source={item.media.url} style={styles.thumbnail} contentFit="cover" /> : <Text style={styles.text}>{item.media.type.toUpperCase()}</Text>}
                <Text style={styles.text} numberOfLines={2}>{item.media.fileName ?? item.media.altText ?? item.media.type}</Text>
              </Pressable>
            )}
          />
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16 },
  title: { color: colors.text, fontSize: 20, fontWeight: '700' },
  action: { color: colors.primary, paddingVertical: 10, fontWeight: '600' },
  disabled: { opacity: 0.3 },
  muted: { color: colors.textTertiary, padding: 8 },
  text: { color: colors.text, padding: 8 },
  preview: { flex: 1, alignItems: 'center' },
  photo: { width: '100%', flex: 1 },
  grid: { padding: 8 },
  tile: { flex: 1, maxWidth: '33.333%', padding: 4 },
  thumbnail: { width: '100%', aspectRatio: 1, borderRadius: 8 },
});
