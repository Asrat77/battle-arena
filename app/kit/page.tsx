"use client";

// Living copy of the design's component kit, for checking the shared pieces
// in both themes. Not linked from the nav.

import { useState } from "react";
import { CodeSlots } from "@/components/ctc/CodeSlots";
import { Keypad } from "@/components/ctc/Keypad";
import { Meter, meterText } from "@/components/ctc/Meter";
import { Avatar3D } from "@/components/ui/Avatar3D";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { BotTag, Chip, LiveChip, PresenceChip, RecordChip } from "@/components/ui/Chip";
import { EmptyState } from "@/components/ui/EmptyState";
import { Field } from "@/components/ui/Field";
import { ICONS, Icon3D } from "@/components/ui/Icon3D";
import { Dialog, Sheet } from "@/components/ui/Overlay";
import { Segmented } from "@/components/ui/Segmented";
import { useToast } from "@/components/ui/Toast";
import { useTheme } from "@/lib/theme";
import { MatchPrimitives } from "./MatchPrimitives";

function Spec({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-4 rounded-sheet bg-sf p-6">
      <h2 className="text-[22px] font-semibold tracking-[-.03em]">{title}</h2>
      {children}
    </section>
  );
}

export default function KitPage() {
  const { theme, setTheme } = useTheme();
  const toast = useToast();
  const [dialog, setDialog] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [name, setName] = useState("Abebe");
  const [seg, setSeg] = useState("overall");
  const [code, setCode] = useState("47");
  const [locked, setLocked] = useState<string | null>(null);

  return (
    <div className="relative flex flex-col gap-6">
      <div className="dither" />
      <div className="relative flex flex-col gap-2">
        <span className="eyebrow">Component kit</span>
        <h1 className="text-h1 md:text-display">Flat surfaces, 3D objects</h1>
        <div className="mt-2 max-w-xs">
          <Segmented
            label="Theme"
            value={theme}
            onChange={setTheme}
            options={[
              { value: "dark", label: "Arena Night" },
              { value: "light", label: "Day" },
            ]}
          />
        </div>
      </div>

      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
        <Spec title="Buttons">
          <Button variant="act" icon="lightning" block>
            Quick match
          </Button>
          <Button icon="key" block>
            Private room
          </Button>
          <div className="flex gap-2 [&>*]:flex-1">
            <Button variant="bad" icon="whiteflag">
              Forfeit
            </Button>
            <Button variant="ghost">Cancel</Button>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" icon="link">
              Copy link
            </Button>
            <Button size="sm" icon="binoculars">
              Watch
            </Button>
            <Button size="sm" icon="share">
              Share
            </Button>
          </div>
          <div className="flex gap-2 [&>*]:flex-1">
            <Button variant="act" disabled>
              Lock in
            </Button>
            <Button variant="act" loading>
              Creating…
            </Button>
          </div>
        </Spec>

        <Spec title="Inputs">
          <Field
            label="Display name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            hint={`1–20 characters · ${name.length}/20`}
            error={name.length > 20 ? `That’s ${name.length} characters. Keep it to 20.` : null}
          />
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <Field label="Room code" hideLabel placeholder="CODE" className="mono font-semibold tracking-[.3em]" />
            </div>
            <Button className="h-14">Join</Button>
          </div>
        </Spec>

        <Spec title="Status">
          <div className="flex flex-wrap gap-2">
            <RecordChip state="pending" long />
            <RecordChip state="recorded" block={42} long />
            <RecordChip state="pending" />
            <RecordChip state="recorded" block={38} />
            <RecordChip state="mismatch" />
            <Chip tone="act">Your turn</Chip>
            <Chip icon="binoculars">12</Chip>
            <LiveChip />
            <PresenceChip status="online" />
            <PresenceChip status="in-match" />
            <PresenceChip status="offline" />
            <Chip mono>0x3f2a…9c1d</Chip>
            <Chip tone="you">You</Chip>
            <BotTag />
          </div>
        </Spec>

        <Spec title="Players">
          <div className="flex flex-wrap gap-3">
            {["0xa1", "0xb2", "0xc3", "0xd4", "0xe5", "0xf6", "0x17", "0x28"].map((id) => (
              <Avatar3D key={id} id={id} />
            ))}
            <Avatar3D id="bot" />
          </div>
          <div className="flex items-center gap-4">
            <Avatar3D id="0xa1" seat="you" />
            <Avatar3D id="0xb2" seat="opp" />
            <Avatar3D id="0xc3" size="lg" />
            <Avatar3D id="0xd4" size="sm" />
          </div>
        </Spec>

        <Spec title="Overlays & toasts">
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => setDialog(true)}>
              Dialog
            </Button>
            <Button size="sm" onClick={() => setSheet(true)}>
              Sheet
            </Button>
            <Button
              size="sm"
              onClick={() =>
                toast.show({
                  avatar: { id: "0xb2" },
                  body: (
                    <>
                      <b>Hana</b> invited you to Gebeta
                    </>
                  ),
                  action: { label: "Join", primary: true },
                })
              }
            >
              Invite toast
            </Button>
            <Button
              size="sm"
              onClick={() => toast.show({ icon: "blockchain", body: "Recorded in block #42", href: "/ledger" })}
            >
              Record toast
            </Button>
            <Button
              size="sm"
              onClick={() =>
                toast.show({
                  icon: "boxing",
                  tone: "reward",
                  body: (
                    <>
                      <b>Badge: First Blood</b>
                      <div className="text-small text-ink-2">Recorded in block #43</div>
                    </>
                  ),
                })
              }
            >
              Badge toast
            </Button>
          </div>
          <Segmented
            label="Board"
            value={seg}
            onChange={setSeg}
            options={[
              { value: "overall", label: "Overall" },
              { value: "code", label: "Code" },
              { value: "gebeta", label: "Gebeta" },
            ]}
          />
        </Spec>

        <Spec title="Code entry">
          <CodeSlots value={locked ?? code} masked={!!locked} label="Your secret" />
          {locked ? (
            <Button
              block
              onClick={() => {
                setLocked(null);
                setCode("");
              }}
            >
              Locked {locked} · reset
            </Button>
          ) : (
            <Keypad value={code} onChange={setCode} onSubmit={setLocked} />
          )}
          <span className="text-small text-ink-3">76 px slots, 60 px keys. Used digits fade out. Type 1–9, Backspace or Enter while focused.</span>
        </Spec>

        <Spec title="Feedback meter">
          {(
            [
              [1, 3],
              [2, 3],
              [0, 2],
              [4, 4],
              [0, 0],
            ] as const
          ).map(([exact, present]) => (
            <div key={`${exact}${present}`} className="flex items-center gap-4">
              <Meter exact={exact} present={present} />
              <span aria-hidden className="text-small text-ink-2">
                {meterText(exact, present)}
              </span>
            </div>
          ))}
          <div className="border-t border-line pt-3">
            <CodeSlots value="3852" size="sm" label="Guess" />
          </div>
        </Spec>

        <Spec title="Badges">
          <div className="flex flex-wrap gap-4">
            <Badge icon="boxing" label="First Blood" />
            <Badge icon="lockpick" label="Codebreaker" />
            <Badge icon="sprout" size={64} label="Seed Master" />
            <Badge icon="crown" size={64} locked label="Champion, locked" />
          </div>
        </Spec>
      </div>

      <Spec title="Match header">
        <MatchPrimitives />
      </Spec>

      <Spec title={`3D icons · ${ICONS.length}`}>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(84px,1fr))] gap-3">
          {ICONS.map((n) => (
            <div key={n} className="flex flex-col items-center gap-1 rounded-2xl bg-bg p-2">
              <Icon3D name={n} size={44} />
              <span className="mono text-[11px] text-ink-3">{n}</span>
            </div>
          ))}
        </div>
      </Spec>

      <EmptyState icon="satellite" title="Nothing live right now">
        Start a quick match and it shows up here for others to watch.
      </EmptyState>

      <Dialog
        open={dialog}
        onClose={() => setDialog(false)}
        icon="whiteflag"
        title="Forfeit and give Hana the win?"
        actions={
          <>
            <Button onClick={() => setDialog(false)}>Keep playing</Button>
            <Button variant="bad" onClick={() => setDialog(false)}>
              Forfeit
            </Button>
          </>
        }
      >
        The match ends now and is recorded as a forfeit.
      </Dialog>
      <Sheet open={sheet} onClose={() => setSheet(false)} title="How to play">
        <p className="text-ink-2">Each player picks a secret 4-digit code. Guess theirs before they guess yours.</p>
        <Button variant="act" block onClick={() => setSheet(false)}>
          Got it
        </Button>
      </Sheet>
    </div>
  );
}
