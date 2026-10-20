import type { CanvasWidget } from '../../types/canvas';
import { WidgetWrapper } from './WidgetWrapper';
import { ButtonWidget } from './ButtonWidget';
import { TitleFieldWidget } from './TitleFieldWidget';
import { FilePathWidget } from './FilePathWidget';
import { ScoreboardWidget } from './ScoreboardWidget';
import { RacketScoreboardWidget } from './RacketScoreboardWidget';
import { ScoreLogWidget } from './ScoreLogWidget';
import { ScoreLowerThirdWidget } from './ScoreLowerThirdWidget';
import { PlayerLowerThirdWidget } from './PlayerLowerThirdWidget';
import { SinBinLowerThirdWidget } from './SinBinLowerThirdWidget';
import { TimerWidget } from './TimerWidget';
import { TBarWidget } from './TBarWidget';
import { VolumeWidget } from './VolumeWidget';
import { OverlayWidget } from './OverlayWidget';
import { LabelWidget } from './LabelWidget';
import { InputTallyWidget } from './InputTallyWidget';
import { TransitionsWidget } from './TransitionsWidget';
import { TimelineWidget } from './TimelineWidget';
import { PlayerListWidget } from './PlayerListWidget';
import { SubWidget } from './SubWidget';
import { CardDisplayWidget } from './CardDisplayWidget';
import { PanelWidget } from './PanelWidget';
import { VmixTitlesWidget } from './VmixTitlesWidget';
import { RugbyLineupWidget } from './RugbyLineupWidget';
import { CardLowerThirdWidget } from './CardLowerThirdWidget';
import { PlacementLowerThirdWidget } from './PlacementLowerThirdWidget';
import { CustomTimerWidget } from './CustomTimerWidget';
import { ImageDisplayWidget } from './ImageDisplayWidget';
import { RecentMatchesWidget } from './RecentMatchesWidget';
import { MatchScheduleWidget } from './MatchScheduleWidget';
import { RundownWidget } from './RundownWidget';
import { StandingsWidget } from './StandingsWidget';
import { BracketWidget } from './BracketWidget';
import { TeamFormWidget } from './TeamFormWidget';
import { PlayerHeadToHeadWidget } from './PlayerHeadToHeadWidget';
import { PlayerStatsWidget } from './PlayerStatsWidget';
import { PlayerHighlightWidget } from './PlayerHighlightWidget';
import { GroupStandingsWidget } from './GroupStandingsWidget';
import { CgTemplateWidget } from './CgTemplateWidget';
import type { CgStateName } from '../../lib/cgAnimationEngine';

interface Props {
  widget: CanvasWidget;
  /** True only for the "own CG" output route (see CgOutputPage.tsx) — hides
   *  a widget's own operator-facing controls (Send/Show/Hide buttons, the
   *  placement picker, etc.) so what's captured is just the on-air graphic.
   *  Distinct from a read-only remote viewer (syncClient.isReadOnly), which
   *  still shows those buttons — a producer watching on their phone can
   *  still tap Show/Hide there, this is only for an actual capture source.
   *  Currently only the lower-third-style widgets (the ones with a
   *  clearly separate preview/actions split) honor it. */
  outputOnly?: boolean;
  /** Only ever set by CgChannelOutputPage.tsx for a 'cg-template' widget
   *  that has authored animation states — see CgTemplateWidget.tsx. */
  playPhase?: CgStateName;
  /** Bumped each time the "Next Stage" button (CgPlayoutPanel.tsx) resumes
   *  this layer past a timeline stop point — see CgTemplateWidget.tsx. */
  continueSignal?: number;
  /** Bumped each time a `Cg.Loop` button action force-restarts this layer's
   *  Loop timeline — see CgTemplateWidget.tsx. */
  loopSignal?: number;
  /** Bumped on EVERY playLayer() call, even one that leaves this layer's
   *  status at 'playing' unchanged (Play/Cg.In pressed again while already
   *  on air) — see CgTemplateWidget.tsx and cgPlayoutStore.ts's playLayer. */
  playSignal?: number;
  /** `Date.now()` from whenever this layer actually went live — see
   *  cgPlayoutStore.ts's own doc comment on `CgLayer.playStartedAt` and
   *  CgTemplateWidget.tsx's playPhase effect for what it's used for (telling
   *  a late-joining output client apart from the client the Play command
   *  was actually meant for). */
  playStartedAt?: number;
}

export function WidgetRenderer({ widget, outputOnly, playPhase, continueSignal, loopSignal, playSignal, playStartedAt }: Props) {
  const { id, type, config, w, h } = widget;
  const sharedProps = { config, w, h };

  let content: React.ReactNode;

  switch (type) {
    case 'button':      content = <ButtonWidget widgetId={id} {...sharedProps} />; break;
    case 'title-field': content = <TitleFieldWidget {...sharedProps} />; break;
    case 'file-path':   content = <FilePathWidget widgetId={id} {...sharedProps} />; break;
    case 'scoreboard':  content = <ScoreboardWidget widgetId={id} {...sharedProps} />; break;
    case 'racket-scoreboard': content = <RacketScoreboardWidget widgetId={id} {...sharedProps} />; break;
    case 'score-log':          content = <ScoreLogWidget widgetId={id} {...sharedProps} />; break;
    case 'score-lower-third':      content = <ScoreLowerThirdWidget widgetId={id} outputOnly={outputOnly} {...sharedProps} />; break;
    case 'player-lower-third':     content = <PlayerLowerThirdWidget widgetId={id} outputOnly={outputOnly} {...sharedProps} />; break;
    case 'sin-bin-lower-third':    content = <SinBinLowerThirdWidget widgetId={id} outputOnly={outputOnly} {...sharedProps} />; break;
    case 'timer':       content = <TimerWidget widgetId={id} {...sharedProps} />; break;
    case 'tbar':        content = <TBarWidget {...sharedProps} />; break;
    case 'volume':      content = <VolumeWidget {...sharedProps} />; break;
    case 'overlay':     content = <OverlayWidget {...sharedProps} />; break;
    case 'label':       content = <LabelWidget {...sharedProps} />; break;
    case 'input-tally': content = <InputTallyWidget {...sharedProps} />; break;
    case 'transitions': content = <TransitionsWidget {...sharedProps} />; break;
    case 'timeline':    content = <TimelineWidget widgetId={id} {...sharedProps} />; break;
    case 'player-list':  content = <PlayerListWidget widgetId={id} {...sharedProps} />; break;
    case 'player-list-next': content = <PlayerListWidget widgetId={id} nextMatchMode {...sharedProps} />; break;
    case 'substitution':  content = <SubWidget widgetId={id} {...sharedProps} />; break;
    case 'card-display':  content = <CardDisplayWidget widgetId={id} {...sharedProps} />; break;
    case 'panel':         content = <PanelWidget {...sharedProps} />; break;
    case 'vmix-titles':   content = <VmixTitlesWidget {...sharedProps} />; break;
    case 'rugby-lineup':       content = <RugbyLineupWidget widgetId={id} {...sharedProps} />; break;
    case 'rugby-lineup-next':  content = <RugbyLineupWidget widgetId={id} nextMatchMode {...sharedProps} />; break;
    case 'card-lower-third':   content = <CardLowerThirdWidget widgetId={id} outputOnly={outputOnly} {...sharedProps} />; break;
    case 'placement-lower-third': content = <PlacementLowerThirdWidget widgetId={id} outputOnly={outputOnly} {...sharedProps} />; break;
    case 'pomodoro':           content = <CustomTimerWidget widgetId={id} {...sharedProps} />; break;
    case 'image-display':      content = <ImageDisplayWidget config={config} />; break;
    case 'recent-matches':     content = <RecentMatchesWidget widgetId={id} {...sharedProps} />; break;
    case 'match-schedule':     content = <MatchScheduleWidget widgetId={id} {...sharedProps} />; break;
    case 'rundown':            content = <RundownWidget {...sharedProps} />; break;
    case 'standings':          content = <StandingsWidget widgetId={id} {...sharedProps} />; break;
    case 'bracket':            content = <BracketWidget widgetId={id} {...sharedProps} />; break;
    case 'team-form':          content = <TeamFormWidget widgetId={id} {...sharedProps} />; break;
    case 'player-h2h':         content = <PlayerHeadToHeadWidget widgetId={id} {...sharedProps} />; break;
    case 'player-stats':       content = <PlayerStatsWidget widgetId={id} {...sharedProps} />; break;
    case 'player-highlight':   content = <PlayerHighlightWidget widgetId={id} {...sharedProps} />; break;
    case 'group-standings':    content = <GroupStandingsWidget widgetId={id} {...sharedProps} />; break;
    case 'cg-template':        content = <CgTemplateWidget playPhase={playPhase} continueSignal={continueSignal} loopSignal={loopSignal} playSignal={playSignal} playStartedAt={playStartedAt} outputOnly={outputOnly} {...sharedProps} />; break;
    default:            content = <div style={{ padding: 8, fontSize: 11 }}>Unknown widget</div>;
  }

  return (
    <WidgetWrapper widget={widget} outputOnly={outputOnly}>
      {content}
    </WidgetWrapper>
  );
}
