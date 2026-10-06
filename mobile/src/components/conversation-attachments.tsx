import { Image } from 'expo-image';
import { useEffect, useRef, useState } from 'react';
import { FlatList, Modal, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { ConversationAttachment } from '@/messages/attachment-index';
import { colors } from '@/theme';
import { MessageAttachment } from './message-attachment';
import { Icon } from './ui';

function PhotoPager({ items, selectedId, select }: { items: ConversationAttachment[]; selectedId: string; select: (id: string) => void }) {
  const { width } = useWindowDimensions();
  const photos = items.filter((item) => item.media.type === 'image');
  const index = Math.max(0, photos.findIndex((item) => item.id === selectedId));
  const ref = useRef<FlatList<ConversationAttachment>>(null);
  useEffect(() => { ref.current?.scrollToIndex({ index, animated: false }); }, [index, width]);
  return <FlatList
    ref={ref} data={photos} horizontal pagingEnabled showsHorizontalScrollIndicator={false}
    initialScrollIndex={index} keyExtractor={(item) => item.id} style={styles.photo}
    getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
    onMomentumScrollEnd={(event) => {
      const photo = photos[Math.round(event.nativeEvent.contentOffset.x / width)];
      if (photo) select(photo.id);
    }}
    renderItem={({ item }) => <Image source={item.media.url} style={{ width, height: '100%' }} contentFit="contain" accessibilityLabel={item.media.altText ?? 'Shared photo'} />}
  />;
}

export function ConversationAttachments({ items, onClose, onShowMessage }: {
  items: ConversationAttachment[]; onClose: () => void; onShowMessage: (id: string) => void;
}) {
  const insets = useSafeAreaInsets();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState('All');
  const visibleItems = items.filter((item) => filter === 'All' || (filter === 'Photos' ? item.media.type === 'image' : item.media.type !== 'image'));
  const selectedIndex = items.findIndex((item) => item.id === selectedId);
  const selected = items[selectedIndex];
  const close = () => { setSelectedId(null); onClose(); };
  return (
    <Modal animationType="slide" onRequestClose={close}>
      <View style={[styles.screen, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        <View style={styles.header}>
          <Text style={styles.title}>{selected ? `${selectedIndex + 1} of ${items.length}` : 'Media & files'}</Text>
          <Pressable onPress={close} accessibilityRole="button"><Text style={styles.action}>Done</Text></Pressable>
        </View>
        {selected ? (
          <View style={styles.preview}>
            <View style={styles.header}>
              <Pressable onPress={() => setSelectedId(null)}><Text style={styles.action}>All attachments</Text></Pressable>
            </View>
            {selected.media.type === 'image' ? (
              <PhotoPager items={items} selectedId={selected.id} select={setSelectedId} />
            ) : <ScrollView style={styles.documentPreview} contentContainerStyle={{ alignItems: 'center', paddingVertical: 20 }}><MessageAttachment key={selected.id} media={selected.media} /></ScrollView>}
            <Text style={styles.caption} numberOfLines={3}>{selected.media.fileName ?? selected.media.altText ?? selected.media.type}</Text>
            <View style={styles.footer}>
              <Pressable disabled={selectedIndex === 0} onPress={() => setSelectedId(items[selectedIndex - 1].id)} accessibilityLabel="Previous attachment"><Text style={[styles.action, selectedIndex === 0 && styles.disabled]}>Previous</Text></Pressable>
              <Pressable style={styles.showChat} onPress={() => onShowMessage(selected.messageId)} accessibilityRole="button"><Icon name="bubble.left" size={16} color={colors.bg} /><Text style={styles.showChatText}>Show in chat</Text></Pressable>
              <Pressable disabled={selectedIndex === items.length - 1} onPress={() => setSelectedId(items[selectedIndex + 1].id)} accessibilityLabel="Next attachment"><Text style={[styles.action, selectedIndex === items.length - 1 && styles.disabled]}>Next</Text></Pressable>
            </View>
          </View>
        ) : (
          <View style={{ flex: 1 }}>
          <View style={styles.filters}>{['All', 'Photos', 'Files'].map((value) => <Pressable key={value} style={[styles.filter, filter === value && styles.filterSelected]} onPress={() => setFilter(value)} accessibilityRole="button" accessibilityState={{ selected: filter === value }}><Text style={filter === value ? styles.showChatText : styles.text}>{value}</Text></Pressable>)}</View>
          <FlatList
            data={visibleItems} numColumns={3} keyExtractor={(item) => item.id}
            ListEmptyComponent={<View style={styles.empty}><Icon name="photo" size={38} color={colors.textTertiary} /><Text style={styles.title}>Nothing shared yet</Text><Text style={styles.muted}>Photos and files from this chat will appear here.</Text></View>}
            ListFooterComponent={items.length ? <Text style={styles.muted}>{visibleItems.length} attachments · loaded messages</Text> : null}
            contentContainerStyle={styles.grid}
            renderItem={({ item }) => (
              <Pressable style={styles.tile} onPress={() => setSelectedId(item.id)} accessibilityRole="button" accessibilityLabel={`Preview ${item.media.fileName ?? item.media.type}`}>
                {item.media.type === 'image' ? <Image source={item.media.url} style={styles.thumbnail} contentFit="cover" /> : <View style={styles.fileTile}><Icon name={item.media.type === 'video' ? 'play.rectangle.fill' : item.media.type === 'audio' ? 'waveform' : 'doc.text.fill'} size={28} color={colors.primary} /><Text style={styles.muted}>{item.media.type.toUpperCase()}</Text></View>}
                <Text style={styles.text} numberOfLines={2}>{item.media.fileName ?? item.media.altText ?? item.media.type}</Text>
              </Pressable>
            )}
          />
          </View>
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
  documentPreview: { width: '100%', flex: 1 },
  caption: { color: colors.textSecondary, padding: 16, textAlign: 'center' },
  footer: { width: '100%', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.separator },
  showChat: { backgroundColor: colors.primary, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 10, flexDirection: 'row', gap: 6, alignItems: 'center' },
  showChatText: { color: colors.bg, fontWeight: '700' },
  filters: { flexDirection: 'row', gap: 8, paddingHorizontal: 12, paddingBottom: 12 },
  filter: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20, backgroundColor: colors.surface },
  filterSelected: { backgroundColor: colors.primary },
  fileTile: { width: '100%', aspectRatio: 1, backgroundColor: colors.surface, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  empty: { alignItems: 'center', gap: 12, padding: 40 },
  photo: { width: '100%', flex: 1 },
  grid: { padding: 8 },
  tile: { flex: 1, maxWidth: '33.333%', padding: 4 },
  thumbnail: { width: '100%', aspectRatio: 1, borderRadius: 8 },
});
