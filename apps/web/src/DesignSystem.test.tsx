import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { PageHeading, Stat } from './ui';
it('distinguishes unavailable counts from actual zero and retains context',()=>{
 render(<><PageHeading eyebrow="TA’LIM" title="Bosh sahifa" description="Bugungi holat"/><Stat title="Faol guruhlar" value={0} icon={null} note="Amaldagi guruhlar"/><Stat title="O‘quvchilar" value={null} icon={null} note="Yuklanmoqda"/></>);
 expect(screen.getByRole('heading',{level:1})).toHaveTextContent('Bosh sahifa');
 expect(screen.getByText('0')).toBeVisible();expect(screen.getByText('—')).toBeVisible();
});
