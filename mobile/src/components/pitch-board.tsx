// A football pitch with a formation's slots on it — the phone's version of
// the web's PitchBoard (a green gradient with SVG markings). Slot x/y come
// from lib/formations.ts as percentages, the same numbers the web draws with,
// so a lineup reads identically on both. Markings are plain Views: no SVG
// module to add for a few lines and a circle.

import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { FormationSlot } from '@/lib/formations';
import { fonts } from '~/theme';
import { initialsOf } from '~/components/chat';

export function PitchBoard({
  slots,
  lineup,
  nameById,
  onSlotPress,
}: {
  slots: FormationSlot[];
  lineup: Record<number, string>;
  nameById: Map<string, string>;
  /** Omit for a read-only board. */
  onSlotPress?: (index: number) => void;
}) {
  return (
    <View style={styles.pitch}>
      {/* markings */}
      <View style={[styles.line, styles.outline]} />
      <View style={[styles.line, styles.halfway]} />
      <View style={[styles.line, styles.circle]} />
      <View style={[styles.line, styles.boxTop]} />
      <View style={[styles.line, styles.boxBottom]} />

      {slots.map((slot, i) => {
        const pid = lineup[i];
        // A saved player who has since left the squad shows as an empty slot —
        // a transfer leaves a hole in the plan, never a ghost name.
        const name = pid ? nameById.get(pid) : undefined;
        return (
          <Pressable
            key={i}
            disabled={!onSlotPress}
            onPress={() => onSlotPress?.(i)}
            style={[styles.slot, { left: `${slot.x}%`, top: `${slot.y}%` }]}>
            <View style={[styles.dot, name ? styles.dotFilled : styles.dotEmpty]}>
              <Text style={[styles.dotText, !name && { color: 'rgba(255,255,255,0.8)' }]}>
                {name ? initialsOf(name) : slot.position}
              </Text>
            </View>
            <Text style={styles.label} numberOfLines={1}>
              {name ? name.split(' ')[0] : ''}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const LINE = 'rgba(255,255,255,0.35)';

const styles = StyleSheet.create({
  pitch: {
    width: '100%',
    aspectRatio: 100 / 130,
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: '#1d661d',
  },
  line: { position: 'absolute', borderColor: LINE, borderWidth: 1 },
  outline: { left: '5%', right: '5%', top: '3.8%', bottom: '3.8%', borderRadius: 2 },
  halfway: { left: '5%', right: '5%', top: '50%', height: 0, borderWidth: 0, borderTopWidth: 1 },
  circle: { left: '40%', width: '20%', aspectRatio: 1, top: '42.3%', borderRadius: 999 },
  boxTop: { left: '22%', width: '56%', top: '3.8%', height: '13.8%' },
  boxBottom: { left: '22%', width: '56%', bottom: '3.8%', height: '13.8%' },
  slot: { position: 'absolute', width: 64, marginLeft: -32, marginTop: -20, alignItems: 'center' },
  dot: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', borderWidth: 2 },
  dotFilled: { backgroundColor: '#ffffff', borderColor: '#ffffff' },
  dotEmpty: { backgroundColor: 'rgba(255,255,255,0.12)', borderColor: 'rgba(255,255,255,0.6)', borderStyle: 'dashed' },
  dotText: { color: '#0E7A3C', fontFamily: fonts.bold, fontSize: 11 },
  label: { color: '#fff', fontFamily: fonts.semibold, fontSize: 10, marginTop: 2 },
});
