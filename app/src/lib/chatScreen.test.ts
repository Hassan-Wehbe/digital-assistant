// The chat screen with the Wilma box (docs/ui-review.md, plan step 5): 📍 lives in the ＋ menu and
// still reads the location only when tapped, for one message; one status chip; "New chat".
import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const src = readFileSync(resolve(__dirname, '../app/chat.tsx'), 'utf8');

describe('the chat screen', () => {
  it('uses the Wilma box, with ■ Stop while Wilma writes', () => {
    expect(src).toContain('<WilmaBox');
    expect(src).toContain('onStop={state.streaming ? stop : undefined}');
    expect(src).not.toMatch(/<TextInput\s/); // only the box draws a text field
  });

  it('reads the location only on the menu tap, and sends it with one message', () => {
    // deviceLocation appears in its import and in the one tap handler, nowhere else.
    expect(src.match(/deviceLocation/g)).toHaveLength(2);
    expect(src).toMatch(/const onPin = async \(\) => \{[\s\S]*?tapPin\(pin, deviceLocation\)[\s\S]*?\n  \};/);
    expect(src).toMatch(/<GroupRow\s+first\s+title=\{pinPoint\(pin\) \? '📍 Don’t send where I am' : '📍 Send where I am'\}[\s\S]*?onPress=\{onPin\}/);
    expect(src).toContain('const out = await send(text, pinPoint(pin));');
    // After a sent message, the 📍 is off again.
    expect(src).toMatch(/setText\(''\);\n\s+setPin\(null\);/);
    expect(src).not.toMatch(/useEffect\([^)]*tapPin/);
  });

  it('has one status line (the chip) instead of a stack of grey lines', () => {
    expect(src).toContain('const chip = chatChip({ blocked: state.blocked, locating, pin, micError: mic.error });');
    expect(src).not.toContain('{state.blocked ? <Muted>');
    expect(src).not.toContain('{mic.error ? <Muted>');
  });

  it('says "New chat"', () => {
    expect(src).toContain('accessibilityLabel="New chat"');
  });
});
