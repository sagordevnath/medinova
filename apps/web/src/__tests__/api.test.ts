import { describe, expect, it } from 'vitest';
import { formatBdt } from '@/lib/api';
describe('formatters',()=>{it('formats BDT without fractional noise',()=>{expect(formatBdt(1200,'en')).toBe('৳1,200');expect(formatBdt(1200,'bn')).toContain('৳')})});
