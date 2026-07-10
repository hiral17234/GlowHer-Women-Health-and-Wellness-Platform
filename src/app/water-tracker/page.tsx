"use client";

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { addDays, format, differenceInDays, startOfDay, isWithinInterval, isSameDay, subDays, differenceInHours } from 'date-fns';
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";
import {
  ChevronLeft, Droplet, Droplets, Plus, Minus, GlassWater, Info, Goal, History,
  Bell, Flame, Award, TrendingUp, Sparkles, Target, Zap, Trophy, BarChart3,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { WaterLogHistory } from '@/components/glowher/WaterLogHistory';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { AppSidebar } from '@/components/glowher/AppSidebar';


const settingsFormSchema = z.object({
  goal: z.coerce.number().min(1, "Goal must be at least 1.").positive(),
});

const reminderFormSchema = z.object({
    remindersEnabled: z.boolean(),
    reminderFrequency: z.coerce.number(), // in hours
});

type SettingsFormData = z.infer<typeof settingsFormSchema>;
type ReminderFormData = z.infer<typeof reminderFormSchema>;
type Unit = 'cups' | 'ml' | 'oz';
type WaterLogEntry = { time: string; amount: number }; // amount in cups
type DailyLog = {
    entries: WaterLogEntry[];
};
type DayData = { label: string; dateKey: string; total: number; goalMet: boolean };


const unitConversions = {
  cups: 1,
  ml: 236.588,
  oz: 8,
};

const phaseTips: { [key: string]: string } = {
    Menstrual: "Herbal teas count! Try raspberry leaf or ginger tea to soothe cramps and stay hydrated.",
    Follicular: "Your energy is rising. Match it with consistent hydration to support your body's preparation for ovulation.",
    Ovulatory: "You might be more active now. Add an extra glass or two, especially if you're exercising.",
    Luteal: "Feeling bloated? It sounds counterintuitive, but drinking more water helps flush out excess sodium and reduce puffiness."
};

const motivationalMessages = [
    "Great job!",
    "Keep it up!",
    "You're doing amazing!",
    "One step closer to your goal!",
    "Way to hydrate!",
    "Every sip counts!",
    "Fantastic work!",
];

const achievementTiers = [
    { streak: 3, title: "Hydration Starter", description: "3-day streak!" },
    { streak: 7, title: "Hydration Habit", description: "7-day streak!" },
    { streak: 14, title: "Hydration Pro", description: "14-day streak!" },
    { streak: 30, title: "Hydration Hero", description: "30-day streak!" },
];

// Quick-add options are expressed in ml and converted to cups (the app's
// canonical storage unit) before ever touching changeIntake(), so the
// existing intake/removal logic is exercised exactly as it was written.
const quickAddOptions = [
    { label: '100 ml', ml: 100, icon: '💧' },
    { label: '250 ml', ml: 250, icon: '🥛' },
    { label: '500 ml', ml: 500, icon: '🧋' },
    { label: '1 L', ml: 1000, icon: '🍶' },
];

// Fixed (non-random) layout so server-rendered and hydrated markup match.
const BG_PARTICLES = [
  { top: '8%', left: '12%', size: 5, delay: '0s', duration: '9s' },
  { top: '18%', left: '82%', size: 3, delay: '1.2s', duration: '11s' },
  { top: '32%', left: '6%', size: 4, delay: '2.4s', duration: '8s' },
  { top: '46%', left: '92%', size: 6, delay: '0.6s', duration: '12s' },
  { top: '61%', left: '20%', size: 3, delay: '3.1s', duration: '10s' },
  { top: '74%', left: '70%', size: 5, delay: '1.8s', duration: '9.5s' },
  { top: '85%', left: '38%', size: 4, delay: '2.9s', duration: '13s' },
  { top: '12%', left: '55%', size: 3, delay: '0.3s', duration: '10.5s' },
];

const LOCAL_STORAGE_PREFIX = 'glowher-water-tracker-';
const REMINDER_SOUND_URL = '/sounds/water-drop.mp3';

// Lightweight count-up used for hero + stat numbers. Falls back to an
// instant snap when the user has requested reduced motion.
function AnimatedNumber({ value, decimals = 0, suffix = '' }: { value: number; decimals?: number; suffix?: string }) {
  const [display, setDisplay] = useState(value);
  const prevValueRef = useRef(value);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const prefersReduced = typeof window !== 'undefined' &&
      window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (prefersReduced) {
      setDisplay(value);
      prevValueRef.current = value;
      return;
    }

    const start = prevValueRef.current;
    const end = value;
    const startTime = performance.now();
    const duration = 650;

    const step = (now: number) => {
      const elapsed = now - startTime;
      const t = Math.min(1, elapsed / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplay(start + (end - start) * eased);
      if (t < 1) {
        rafRef.current = requestAnimationFrame(step);
      } else {
        prevValueRef.current = end;
      }
    };
    rafRef.current = requestAnimationFrame(step);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [value]);

  return <span className="tabular-nums">{display.toFixed(decimals)}{suffix}</span>;
}

// The signature element: a bottle silhouette with a clipped liquid fill,
// two offset wave paths for a subtle liquid-motion shimmer, and a soft
// glass highlight. Fill height is driven entirely by `progressPct`.
function LiquidBottle({ progressPct, justSplashed }: { progressPct: number; justSplashed: number }) {
  const clamped = Math.max(0, Math.min(100, progressPct));
  const bodyTop = 75;
  const bodyBottom = 385;
  const bodyHeight = bodyBottom - bodyTop;
  const fillY = bodyBottom - (clamped / 100) * bodyHeight;

  return (
    <div className="relative w-40 h-80 md:w-48 md:h-96 mx-auto select-none">
      <svg viewBox="0 0 200 400" className="w-full h-full drop-shadow-[0_20px_40px_rgba(8,145,178,0.35)]">
        <defs>
          <clipPath id="bottleClip">
            <rect x="25" y={bodyTop} width="150" height={bodyHeight} rx="46" />
            <rect x="78" y="12" width="44" height="72" rx="10" />
          </clipPath>
          <linearGradient id="waterGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#a5f3fc" />
            <stop offset="45%" stopColor="#22d3ee" />
            <stop offset="100%" stopColor="#0e7490" />
          </linearGradient>
          <linearGradient id="capGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#5eead4" />
            <stop offset="100%" stopColor="#0d9488" />
          </linearGradient>
        </defs>

        {/* Glass silhouette */}
        <rect x="25" y={bodyTop} width="150" height={bodyHeight} rx="46" fill="rgba(255,255,255,0.07)" stroke="rgba(255,255,255,0.45)" strokeWidth="2.5" />
        <rect x="78" y="12" width="44" height="72" rx="10" fill="rgba(255,255,255,0.07)" stroke="rgba(255,255,255,0.45)" strokeWidth="2.5" />
        <rect x="70" y="0" width="60" height="20" rx="7" fill="url(#capGradient)" />

        {/* Liquid, clipped to the bottle silhouette */}
        <g clipPath="url(#bottleClip)">
          <rect
            x="0" y={fillY} width="200" height="400"
            fill="url(#waterGradient)"
            style={{ transition: 'y 0.9s cubic-bezier(0.34,1.56,0.64,1)' }}
          />
          <g style={{ transform: `translateY(${fillY - 10}px)`, transition: 'transform 0.9s cubic-bezier(0.34,1.56,0.64,1)' }}>
            <path
              d="M-200,20 C-150,0 -50,0 0,20 C50,40 150,40 200,20 C250,0 350,0 400,20 L400,60 L-200,60 Z"
              fill="rgba(255,255,255,0.28)"
              className="ht-wave ht-wave-1"
            />
            <path
              d="M-200,26 C-140,8 -60,8 0,26 C60,44 140,44 200,26 C260,8 340,8 400,26 L400,60 L-200,60 Z"
              fill="rgba(255,255,255,0.16)"
              className="ht-wave ht-wave-2"
            />
          </g>
          {/* glass shine */}
          <ellipse cx="58" cy="220" rx="12" ry="90" fill="rgba(255,255,255,0.16)" />
        </g>

        {/* Splash particles, replayed by remounting on key change */}
        {justSplashed > 0 && (
          <g key={justSplashed} clipPath="url(#bottleClip)">
            <circle cx="70" cy={fillY} r="4" fill="#ecfeff" className="ht-splash-particle" style={{ animationDelay: '0ms' }} />
            <circle cx="100" cy={fillY} r="5" fill="#a5f3fc" className="ht-splash-particle" style={{ animationDelay: '60ms' }} />
            <circle cx="130" cy={fillY} r="3.5" fill="#ecfeff" className="ht-splash-particle" style={{ animationDelay: '120ms' }} />
          </g>
        )}
      </svg>

      {/* Floating droplets around the bottle */}
      <Droplet className="absolute -top-2 -left-4 h-5 w-5 text-cyan-200/70 ht-float-slow" />
      <Droplet className="absolute top-10 -right-5 h-4 w-4 text-teal-200/60 ht-float-medium" />
      <Droplet className="absolute bottom-6 -left-6 h-4 w-4 text-cyan-100/50 ht-float-fast" />
    </div>
  );
}

export default function WaterTrackerPage() {
  const router = useRouter();
  const { toast } = useToast();

  const [currentDateKey, setCurrentDateKey] = useState<string | null>(null);
  const [dailyLog, setDailyLog] = useState<DailyLog>({ entries: [] });
  const [goal, setGoal] = useState(8); // Always stored in cups
  const [unit, setUnit] = useState<Unit>('cups');
  const [currentPhase, setCurrentPhase] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [hydrationStreak, setHydrationStreak] = useState(0);

  // --- Redesign-only additive state (no existing state above was touched) ---
  const [weeklyData, setWeeklyData] = useState<DayData[]>([]);
  const [splashTrigger, setSplashTrigger] = useState(0);
  const [justUnlocked, setJustUnlocked] = useState<string | null>(null);
  const [hoveredBarIndex, setHoveredBarIndex] = useState<number | null>(null);
  const prevStreakRef = useRef(0);

  useEffect(() => {
    setCurrentDateKey(format(new Date(), 'yyyy-MM-dd'));
  }, []);

  const settingsForm = useForm<SettingsFormData>({
    resolver: zodResolver(settingsFormSchema),
    defaultValues: {
      goal: 8,
    },
  });

  const reminderForm = useForm<ReminderFormData>({
    resolver: zodResolver(reminderFormSchema),
    defaultValues: {
        remindersEnabled: false,
        reminderFrequency: 2,
    },
  });

  const calculateStreak = () => {
    try {
        let streak = 0;
        const today = startOfDay(new Date());
        let dailyGoal = 8;
        
        const savedSettings = localStorage.getItem(`${LOCAL_STORAGE_PREFIX}settings`);
        if (savedSettings) {
            dailyGoal = JSON.parse(savedSettings).goal || 8;
        }

        // Check today's log first. If today's goal isn't met, streak is 0.
        const todayLogData = localStorage.getItem(`${LOCAL_STORAGE_PREFIX}${format(today, 'yyyy-MM-dd')}`);
        if(todayLogData) {
            const todayLog: DailyLog = JSON.parse(todayLogData);
            const todayIntake = todayLog.entries?.reduce((sum, entry) => sum + entry.amount, 0) || 0;
            if (todayIntake >= dailyGoal) {
                streak = 1;
            }
        }
        
        // If today's goal was met, check previous days
        if (streak > 0) {
            for (let i = 1; i <= 30; i++) {
                const dateToCheck = subDays(today, i);
                const dateKey = format(dateToCheck, 'yyyy-MM-dd');
                const logData = localStorage.getItem(`${LOCAL_STORAGE_PREFIX}${dateKey}`);

                if (logData) {
                    const log: DailyLog = JSON.parse(logData);
                    const totalIntake = log.entries?.reduce((sum, entry) => sum + entry.amount, 0) || 0;
                    if (totalIntake >= dailyGoal) {
                        streak++;
                    } else {
                        break; // Streak broken because goal not met
                    }
                } else {
                    break; // Streak broken because a day was missed
                }
            }
        }

        setHydrationStreak(streak);
    } catch (e) {
        console.error("Error calculating streak:", e);
    }
};

  // Additive, read-only: builds the last 7 days of totals for the
  // analytics chart and the 7-day average stat. Never writes to storage.
  const computeWeeklyData = () => {
    try {
        const data: DayData[] = [];
        const today = startOfDay(new Date());
        let dailyGoal = 8;
        const savedSettings = localStorage.getItem(`${LOCAL_STORAGE_PREFIX}settings`);
        if (savedSettings) {
            dailyGoal = JSON.parse(savedSettings).goal || 8;
        }

        for (let i = 6; i >= 0; i--) {
            const d = subDays(today, i);
            const dateKey = format(d, 'yyyy-MM-dd');
            const raw = localStorage.getItem(`${LOCAL_STORAGE_PREFIX}${dateKey}`);
            let total = 0;
            if (raw) {
                const log: DailyLog = JSON.parse(raw);
                total = log.entries?.reduce((sum, entry) => sum + entry.amount, 0) || 0;
            }
            data.push({ label: format(d, 'EEEEE'), dateKey, total, goalMet: total >= dailyGoal });
        }
        setWeeklyData(data);
    } catch (e) {
        console.error("Error computing weekly data:", e);
    }
  };

  useEffect(() => {
    if (!currentDateKey) return;
    
    // Initialize audio on client
    if (typeof window !== 'undefined') {
        audioRef.current = new Audio(REMINDER_SOUND_URL);
    }
    
    // Load settings from local storage
    try {
        const savedSettings = localStorage.getItem(`${LOCAL_STORAGE_PREFIX}settings`);
        if (savedSettings) {
            const { goal: savedGoal, unit: savedUnit } = JSON.parse(savedSettings);
            if (savedGoal && savedUnit) {
                setGoal(savedGoal);
                setUnit(savedUnit);
                settingsForm.setValue('goal', Math.round(savedGoal * unitConversions[savedUnit]));
            }
        }
        const savedReminders = localStorage.getItem(`${LOCAL_STORAGE_PREFIX}reminders`);
        if (savedReminders) {
            reminderForm.reset(JSON.parse(savedReminders));
        }
    } catch(e) { console.error("Error loading settings:", e)}
    
    // Load today's intake
    try {
        const savedLog = localStorage.getItem(`${LOCAL_STORAGE_PREFIX}${currentDateKey}`);
        if (savedLog) {
            setDailyLog(JSON.parse(savedLog));
        } else {
            setDailyLog({ entries: [] });
        }
    } catch(e) { console.error("Error loading daily log:", e)}

    // Determine current cycle phase
    try {
        const periodData = localStorage.getItem('glowher-period-tracker');
        if (periodData) {
            const data = JSON.parse(periodData);
            const today = startOfDay(new Date());
            const lastPeriod = startOfDay(new Date(data.lastPeriodDate));
            const cycleLength = data.cycleLength;
            const lutealPhase = data.lutealPhaseLength || 14;

            let currentCycleStartDate = lastPeriod;
            while (addDays(currentCycleStartDate, cycleLength) <= today) {
                currentCycleStartDate = addDays(currentCycleStartDate, cycleLength);
            }
            
            const nextPeriodStart = addDays(currentCycleStartDate, cycleLength);
            const ovulationDay = addDays(nextPeriodStart, -lutealPhase);
            const periodEnd = addDays(currentCycleStartDate, 4);

            if (isWithinInterval(today, { start: currentCycleStartDate, end: periodEnd })) {
              setCurrentPhase("Menstrual");
            } else if (isWithinInterval(today, { start: addDays(periodEnd, 1), end: addDays(ovulationDay, -1) })) {
              setCurrentPhase("Follicular");
            } else if (isSameDay(today, ovulationDay)) {
                setCurrentPhase("Ovulatory");
            } else if (isWithinInterval(today, { start: addDays(ovulationDay, 1), end: addDays(nextPeriodStart, -1) })) {
              setCurrentPhase("Luteal");
            }
        }
    } catch(e) { console.error("Error determining cycle phase:", e)}
    
    calculateStreak();
    computeWeeklyData();

  }, [currentDateKey]);

  const playReminderSound = () => {
    if (audioRef.current) {
        audioRef.current.play().catch(error => console.error("Audio playback failed:", error));
    }
  };

  useEffect(() => {
    if (!currentDateKey) return;
    try {
        localStorage.setItem(`${LOCAL_STORAGE_PREFIX}${currentDateKey}`, JSON.stringify(dailyLog));
    } catch(e) { console.error(e) }

    // Keep the weekly chart in sync now that today's entry is persisted.
    computeWeeklyData();

    // Reminder logic
    const reminderSettings = reminderForm.getValues();
    if (reminderSettings.remindersEnabled) {
      let shouldRemind = false;
      let reminderMessage = "";

      if (dailyLog.entries.length > 0) {
          const lastEntryTime = new Date(dailyLog.entries[dailyLog.entries.length - 1].time);
          const hoursSinceLast = differenceInHours(new Date(), lastEntryTime);
          if (hoursSinceLast >= reminderSettings.reminderFrequency) {
            shouldRemind = true;
            reminderMessage = `It's been over ${reminderSettings.reminderFrequency} hours. Time for some water!`;
          }
      } else {
          // Initial reminder if no water logged today
          const now = new Date();
          if (now.getHours() >= 9) { // Only remind after 9am
            shouldRemind = true;
            reminderMessage = "Don't forget to start your day with a glass of water!";
          }
      }

      if(shouldRemind) {
        toast({
            title: "Thirsty?",
            description: reminderMessage,
        });
        playReminderSound();
      }
    }
  }, [dailyLog, currentDateKey]);

  // Celebrate the moment a new achievement tier is crossed.
  useEffect(() => {
    const crossedTier = achievementTiers.find(t => t.streak === hydrationStreak);
    if (crossedTier && hydrationStreak > prevStreakRef.current) {
      setJustUnlocked(crossedTier.title);
      const timeout = setTimeout(() => setJustUnlocked(null), 2800);
      prevStreakRef.current = hydrationStreak;
      return () => clearTimeout(timeout);
    }
    prevStreakRef.current = hydrationStreak;
  }, [hydrationStreak]);

  const handleSetUnit = (newUnit: Unit) => {
    const oldGoalInCups = goal;
    const newGoalForDisplay = oldGoalInCups * unitConversions[newUnit];
    setUnit(newUnit);
    settingsForm.setValue('goal', Math.round(newGoalForDisplay));
    saveSettings(oldGoalInCups, newUnit);
  };
  
  const saveSettings = (goalInCups: number, unit: Unit) => {
    try {
        localStorage.setItem(`${LOCAL_STORAGE_PREFIX}settings`, JSON.stringify({ goal: goalInCups, unit }));
    } catch (e) {
        console.error(e)
    }
  };

  const onSettingsSubmit = (data: SettingsFormData) => {
    const newGoalInCups = data.goal / unitConversions[unit];
    setGoal(newGoalInCups);
    saveSettings(newGoalInCups, unit);
    toast({
      title: "Goal Saved!",
      description: `Your new daily goal is set.`,
    });
  };

  const onReminderSubmit = (data: ReminderFormData) => {
    try {
        localStorage.setItem(`${LOCAL_STORAGE_PREFIX}reminders`, JSON.stringify(data));
        toast({
            title: "Reminder Settings Saved!",
            description: `Your preferences have been updated.`,
        });
    } catch (error) {
        toast({ variant: 'destructive', title: "Error", description: 'Could not save reminder settings.' });
    }
  };


  const totalIntake = dailyLog.entries.reduce((sum, entry) => sum + entry.amount, 0);

  const changeIntake = (amount: number) => { // amount is always in cups
    if (amount < 0 && totalIntake <= 0) return;

    const newEntry: WaterLogEntry = { time: new Date().toISOString(), amount };
    let newEntries: WaterLogEntry[];

    if (amount < 0) {
      const positiveEntries = dailyLog.entries.filter(e => e.amount > 0);
      positiveEntries.pop(); // Remove the last positive entry
      newEntries = positiveEntries;
    } else {
        newEntries = [...dailyLog.entries, newEntry];
    }
    
    setDailyLog({ entries: newEntries });
    calculateStreak();

    if (amount > 0) {
        setSplashTrigger(t => t + 1);
        const randomMessage = motivationalMessages[Math.floor(Math.random() * motivationalMessages.length)];
        const newTotalIntake = newEntries.reduce((sum, entry) => sum + entry.amount, 0);
        toast({
            title: randomMessage,
            description: `You've logged ${Math.round(newTotalIntake * unitConversions[unit])} ${unit} so far.`,
        });
    }
  };

  // Thin wrapper so the quick-add buttons can express amounts in ml while
  // changeIntake continues to receive cups exactly as it always has.
  const handleQuickAdd = (ml: number) => {
    changeIntake(ml / unitConversions.ml);
  };
  
  const intakeInCurrentUnit = totalIntake * unitConversions[unit];
  const goalInCurrentUnit = goal * unitConversions[unit];
  const progress = goal > 0 ? (totalIntake / goal) * 100 : 0;
  const clampedProgress = Math.max(0, Math.min(100, progress));

  // --- Derived, display-only analytics (no impact on stored data) ---
  const avgIntakeCups = weeklyData.length
    ? weeklyData.reduce((sum, d) => sum + d.total, 0) / weeklyData.length
    : 0;
  const weeklyGoalMetPercent = weeklyData.length
    ? (weeklyData.filter(d => d.goalMet).length / weeklyData.length) * 100
    : 0;
  const hydrationScore = Math.round(clampedProgress);
  const maxWeeklyScale = Math.max(goal, ...weeklyData.map(d => d.total), 0.0001);
  const currentTierIndex = [...achievementTiers].reverse().findIndex(t => hydrationStreak >= t.streak);
  const currentTierStreak = currentTierIndex === -1 ? null : achievementTiers[achievementTiers.length - 1 - currentTierIndex].streak;

  if (!currentDateKey) return null;

  return (
    <div className="ht-scope relative flex flex-col min-h-screen overflow-hidden text-slate-100" style={{ background: 'radial-gradient(ellipse at top, #0b3d5c 0%, #062338 45%, #031522 100%)' }}>

      {/* ---------- Ambient background layer ---------- */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -top-32 -left-24 h-96 w-96 rounded-full bg-cyan-500/20 blur-3xl ht-float-slow" />
        <div className="absolute top-1/3 -right-32 h-[28rem] w-[28rem] rounded-full bg-teal-400/15 blur-3xl ht-float-medium" />
        <div className="absolute bottom-0 left-1/4 h-80 w-80 rounded-full bg-sky-400/10 blur-3xl ht-float-fast" />

        {BG_PARTICLES.map((p, i) => (
          <span
            key={i}
            className="absolute rounded-full bg-cyan-100/40 ht-particle"
            style={{ top: p.top, left: p.left, width: p.size, height: p.size, animationDelay: p.delay, animationDuration: p.duration }}
          />
        ))}

        <svg className="absolute bottom-0 left-0 w-[200%] h-40 opacity-20" viewBox="0 0 1400 200" preserveAspectRatio="none">
          <path d="M0,100 C150,150 350,50 700,100 C1050,150 1250,50 1400,100 L1400,200 L0,200 Z" fill="#22d3ee" className="ht-bgwave-1" />
        </svg>
        <svg className="absolute bottom-0 left-0 w-[200%] h-32 opacity-15" viewBox="0 0 1400 200" preserveAspectRatio="none">
          <path d="M0,120 C200,60 400,160 700,110 C1000,60 1200,160 1400,110 L1400,200 L0,200 Z" fill="#2dd4bf" className="ht-bgwave-2" />
        </svg>
      </div>

      <div className="relative flex flex-1">
        <AppSidebar />
        <main className="relative flex-1 flex-grow container mx-auto px-4 py-8 md:py-10">

          <div className="text-center mb-10 ht-fade-up" style={{ animationDelay: '0ms' }}>
            <p className="uppercase tracking-[0.3em] text-xs md:text-sm font-semibold text-cyan-300/80 mb-2" style={{ fontFamily: 'var(--ht-font-body)' }}>
              Daily Hydration
            </p>
            <h1 className="text-4xl md:text-6xl font-bold text-white" style={{ fontFamily: 'var(--ht-font-display)', letterSpacing: '-0.02em' }}>
              Water Intake Tracker
            </h1>
            <p className="mt-3 text-base md:text-lg text-cyan-100/70 max-w-xl mx-auto">
              Hydration is key to feeling your best. Log every sip and watch your streak grow.
            </p>
          </div>

          {/* ---------- Hero ---------- */}
          <div className="ht-glass-card relative overflow-hidden rounded-[2rem] p-6 md:p-10 mb-8 ht-fade-up" style={{ animationDelay: '80ms' }}>
            <div className="grid grid-cols-1 md:grid-cols-[auto_1fr] gap-8 md:gap-12 items-center">
              <LiquidBottle progressPct={clampedProgress} justSplashed={splashTrigger} />

              <div className="flex flex-col items-center md:items-start text-center md:text-left">
                <div className="flex items-center gap-2 text-cyan-300/90 mb-1">
                  <Sparkles className="h-4 w-4" />
                  <span className="text-sm font-medium">{format(new Date(currentDateKey), "EEEE, MMM d")}</span>
                </div>

                <div className="flex items-end gap-3 mb-1">
                  <span className="text-5xl md:text-6xl font-bold text-white" style={{ fontFamily: 'var(--ht-font-display)' }}>
                    <AnimatedNumber value={intakeInCurrentUnit} decimals={unit === 'cups' ? 1 : 0} />
                  </span>
                  <span className="text-lg md:text-xl text-cyan-200/70 mb-1.5">/ {Math.round(goalInCurrentUnit)} {unit}</span>
                </div>

                <p className="text-cyan-100/70 mb-5">
                  {clampedProgress >= 100
                    ? "Goal crushed — your body thanks you. 🎉"
                    : `${Math.max(0, Math.round(goalInCurrentUnit - intakeInCurrentUnit))} ${unit} left to reach today's goal.`}
                </p>

                <div className="flex items-center gap-2 mb-6 w-full max-w-xs">
                  <div className="relative flex-1 h-3 rounded-full bg-white/10 overflow-hidden">
                    <div
                      className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-cyan-400 via-teal-300 to-cyan-200 ht-progress-shine"
                      style={{ width: `${clampedProgress}%`, transition: 'width 0.9s cubic-bezier(0.34,1.56,0.64,1)' }}
                    />
                  </div>
                  <span className="text-sm font-semibold text-cyan-200 w-12 text-right">
                    <AnimatedNumber value={clampedProgress} decimals={0} suffix="%" />
                  </span>
                </div>

                {/* Quick add */}
                <div className="grid grid-cols-4 gap-3 w-full max-w-sm">
                  {quickAddOptions.map(opt => (
                    <button
                      key={opt.ml}
                      onClick={() => handleQuickAdd(opt.ml)}
                      className="ht-quick-btn flex flex-col items-center justify-center gap-1 rounded-2xl py-3 px-1 text-xs font-medium text-cyan-50"
                      aria-label={`Add ${opt.label}`}
                    >
                      <span className="text-lg leading-none">{opt.icon}</span>
                      <span>{opt.label}</span>
                    </button>
                  ))}
                </div>

                <div className="flex items-center gap-3 mt-5">
                  <Button
                    variant="outline"
                    onClick={() => changeIntake(-1)}
                    disabled={totalIntake <= 0}
                    className="ht-ghost-btn rounded-full"
                  >
                    <Minus className="mr-2 h-4 w-4" /> Remove Cup
                  </Button>
                  <Button onClick={() => changeIntake(1)} className="ht-primary-btn rounded-full">
                    <Plus className="mr-2 h-4 w-4" /> Add Cup
                  </Button>
                </div>
              </div>
            </div>

            {currentPhase && phaseTips[currentPhase] && (
              <div className="ht-inset-alert mt-8 flex gap-3 rounded-2xl p-4">
                <Info className="h-5 w-5 text-cyan-300 shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold text-cyan-100">Tip for your {currentPhase} Phase</p>
                  <p className="text-sm text-cyan-100/70 mt-0.5">{phaseTips[currentPhase]}</p>
                </div>
              </div>
            )}
          </div>

          {/* ---------- Stat cards ---------- */}
          <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4 mb-8">
            {[
              { label: "Today's Intake", value: intakeInCurrentUnit, decimals: unit === 'cups' ? 1 : 0, suffix: ` ${unit}`, icon: GlassWater },
              { label: "Goal Remaining", value: Math.max(0, goalInCurrentUnit - intakeInCurrentUnit), decimals: unit === 'cups' ? 1 : 0, suffix: ` ${unit}`, icon: Target },
              { label: "Current Streak", value: hydrationStreak, decimals: 0, suffix: hydrationStreak === 1 ? ' day' : ' days', icon: Flame },
              { label: "Avg Intake (7d)", value: avgIntakeCups * unitConversions[unit], decimals: unit === 'cups' ? 1 : 0, suffix: ` ${unit}`, icon: TrendingUp },
              { label: "Weekly Goal Rate", value: weeklyGoalMetPercent, decimals: 0, suffix: '%', icon: BarChart3 },
              { label: "Hydration Score", value: hydrationScore, decimals: 0, suffix: '', icon: Zap },
            ].map((stat, i) => (
              <div
                key={stat.label}
                className="ht-stat-card ht-fade-up rounded-2xl p-4 flex flex-col justify-between"
                style={{ animationDelay: `${140 + i * 60}ms` }}
              >
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs font-medium text-cyan-200/60 uppercase tracking-wide">{stat.label}</span>
                  <stat.icon className="h-4 w-4 text-cyan-300/70" />
                </div>
                <span className="text-2xl font-bold text-white" style={{ fontFamily: 'var(--ht-font-display)' }}>
                  <AnimatedNumber value={stat.value} decimals={stat.decimals} suffix={stat.suffix} />
                </span>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            <div className="lg:col-span-2 space-y-8">

              {/* ---------- Weekly analytics ---------- */}
              <Card className="ht-glass-card border-0">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-white" style={{ fontFamily: 'var(--ht-font-display)' }}>
                    <BarChart3 className="text-cyan-300 h-5 w-5" /> Weekly Analytics
                  </CardTitle>
                  <CardDescription className="text-cyan-100/60">Your last 7 days, with today's goal line for reference.</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="relative h-40 flex items-end gap-3 md:gap-4">
                    <svg className="absolute inset-0 w-full h-full pointer-events-none" viewBox="0 0 100 100" preserveAspectRatio="none">
                      <line
                        x1="0" x2="100"
                        y1={100 - Math.min(100, (goal / maxWeeklyScale) * 100)}
                        y2={100 - Math.min(100, (goal / maxWeeklyScale) * 100)}
                        stroke="rgba(255,255,255,0.35)" strokeDasharray="2,2" strokeWidth="0.6"
                      />
                      <polyline
                        fill="none" stroke="#5eead4" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"
                        points={weeklyData.map((d, i) => {
                          const x = ((i + 0.5) / 7) * 100;
                          const y = 100 - Math.min(100, (d.total / maxWeeklyScale) * 100);
                          return `${x},${y}`;
                        }).join(' ')}
                      />
                    </svg>

                    {weeklyData.map((d, i) => {
                      const pct = Math.min(100, (d.total / maxWeeklyScale) * 100);
                      const isToday = d.dateKey === currentDateKey;
                      return (
                        <div
                          key={d.dateKey}
                          className="relative flex-1 h-full flex flex-col items-center justify-end gap-2"
                          onMouseEnter={() => setHoveredBarIndex(i)}
                          onMouseLeave={() => setHoveredBarIndex(null)}
                        >
                          {hoveredBarIndex === i && (
                            <div className="absolute -top-8 rounded-lg bg-slate-900/90 text-white text-xs px-2 py-1 whitespace-nowrap z-10 border border-white/10">
                              {(d.total * unitConversions[unit]).toFixed(unit === 'cups' ? 1 : 0)} {unit}
                            </div>
                          )}
                          <div
                            className={cn(
                              "w-full rounded-t-xl ht-bar",
                              d.goalMet ? "bg-gradient-to-t from-teal-500 via-cyan-400 to-cyan-200" : "bg-gradient-to-t from-cyan-800/70 to-cyan-500/50",
                              isToday && "ring-2 ring-cyan-200/80"
                            )}
                            style={{ height: `${Math.max(pct, 3)}%`, transition: 'height 0.8s cubic-bezier(0.34,1.56,0.64,1)' }}
                          />
                          <span className={cn("text-xs font-medium", isToday ? "text-cyan-200" : "text-cyan-100/50")}>{d.label}</span>
                        </div>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>

              <div className="ht-glass-card rounded-2xl p-4">
                <WaterLogHistory />
              </div>
            </div>

            <div className="lg:col-span-1 space-y-8">
              {/* ---------- Goal settings ---------- */}
              <Card className="ht-glass-card border-0">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-white" style={{ fontFamily: 'var(--ht-font-display)' }}>
                    <Goal className="text-cyan-300 h-5 w-5" /> Your Goal
                  </CardTitle>
                  <CardDescription className="text-cyan-100/60">Set your daily hydration target.</CardDescription>
                </CardHeader>
                <CardContent>
                  <Form {...settingsForm}>
                    <form onSubmit={settingsForm.handleSubmit(onSettingsSubmit)} className="space-y-6">
                      <div className="space-y-2">
                        <FormLabel className="text-cyan-100/80">Unit</FormLabel>
                        <Tabs defaultValue={unit} onValueChange={(value) => handleSetUnit(value as Unit)} className="w-full">
                          <TabsList className="grid w-full grid-cols-3 bg-white/5 border border-white/10">
                            <TabsTrigger value="cups" className="data-[state=active]:bg-cyan-400/20 data-[state=active]:text-cyan-100 text-cyan-100/60">Cups</TabsTrigger>
                            <TabsTrigger value="ml" className="data-[state=active]:bg-cyan-400/20 data-[state=active]:text-cyan-100 text-cyan-100/60">ml</TabsTrigger>
                            <TabsTrigger value="oz" className="data-[state=active]:bg-cyan-400/20 data-[state=active]:text-cyan-100 text-cyan-100/60">oz</TabsTrigger>
                          </TabsList>
                        </Tabs>
                      </div>
                      <FormField
                        control={settingsForm.control}
                        name="goal"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-cyan-100/80">Daily Goal ({unit})</FormLabel>
                            <FormControl>
                              <Input type="number" {...field} className="bg-white/5 border-white/15 text-white placeholder:text-cyan-100/30 focus-visible:ring-cyan-300" />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <Button type="submit" className="ht-primary-btn w-full rounded-full">Save Goal</Button>
                    </form>
                  </Form>
                </CardContent>
              </Card>

              {/* ---------- Reminders ---------- */}
              <Card className="ht-glass-card border-0">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-white" style={{ fontFamily: 'var(--ht-font-display)' }}>
                    <Bell className="text-cyan-300 h-5 w-5" /> Hydration Reminders
                  </CardTitle>
                  <CardDescription className="text-cyan-100/60">Get notified to keep up with your goal.</CardDescription>
                </CardHeader>
                <CardContent>
                  <Form {...reminderForm}>
                    <form onChange={reminderForm.handleSubmit(onReminderSubmit)} className="space-y-6">
                      <FormField
                        control={reminderForm.control}
                        name="remindersEnabled"
                        render={({ field }) => (
                          <FormItem className="flex flex-row items-center justify-between rounded-xl border border-white/10 p-3 bg-white/5">
                            <div className="space-y-0.5">
                              <FormLabel className="text-cyan-100/80">Enable Reminders</FormLabel>
                            </div>
                            <FormControl>
                              <Switch checked={field.value} onCheckedChange={field.onChange} className="data-[state=checked]:bg-cyan-400" />
                            </FormControl>
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={reminderForm.control}
                        name="reminderFrequency"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-cyan-100/80">Remind Me Every...</FormLabel>
                            <Select onValueChange={field.onChange} defaultValue={String(field.value)} disabled={!reminderForm.getValues("remindersEnabled")}>
                              <FormControl>
                                <SelectTrigger className="bg-white/5 border-white/15 text-white">
                                  <SelectValue placeholder="Select frequency" />
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent>
                                <SelectItem value="1">1 Hour</SelectItem>
                                <SelectItem value="2">2 Hours</SelectItem>
                                <SelectItem value="3">3 Hours</SelectItem>
                                <SelectItem value="4">4 Hours</SelectItem>
                              </SelectContent>
                            </Select>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </form>
                  </Form>
                </CardContent>
              </Card>

              {/* ---------- Achievements ---------- */}
              <Card className="ht-glass-card border-0 relative overflow-hidden">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-white" style={{ fontFamily: 'var(--ht-font-display)' }}>
                    <Trophy className="text-amber-300 h-5 w-5" /> Achievements
                  </CardTitle>
                  <CardDescription className="text-cyan-100/60">Keep up the great work!</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center justify-center gap-2 text-lg font-bold rounded-xl p-3 bg-gradient-to-r from-orange-500/20 via-amber-400/20 to-orange-500/20 border border-amber-300/20 text-amber-100">
                    <Flame className="h-5 w-5 text-orange-400" />
                    {hydrationStreak > 0 ? `${hydrationStreak}-Day Hydration Streak!` : "Start a new streak today!"}
                  </div>
                  <div className="space-y-2">
                    {achievementTiers.map((tier) => {
                      const unlocked = hydrationStreak >= tier.streak;
                      const isCurrent = currentTierStreak === tier.streak;
                      return (
                        <div
                          key={tier.streak}
                          className={cn(
                            "relative flex items-center gap-3 p-2.5 rounded-xl transition-all overflow-hidden",
                            unlocked ? "bg-white/8 border border-amber-300/20" : "bg-white/[0.02] border border-white/5 opacity-50"
                          )}
                        >
                          {isCurrent && <span className="ht-shine-sweep" />}
                          <Award className={cn("h-6 w-6 shrink-0", unlocked ? "text-amber-300 fill-amber-300/30" : "text-slate-500")} />
                          <div>
                            <p className={cn("font-semibold text-sm", unlocked ? "text-amber-50" : "text-slate-400")}>{tier.title}</p>
                            <p className="text-xs text-cyan-100/40">{tier.description}</p>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {justUnlocked && (
                    <div className="ht-unlock-toast pointer-events-none absolute inset-x-4 top-4 z-20 rounded-xl bg-gradient-to-r from-amber-400 to-orange-400 text-slate-900 font-semibold text-sm px-4 py-2 shadow-lg flex items-center gap-2">
                      <Trophy className="h-4 w-4" /> Unlocked: {justUnlocked}
                      {Array.from({ length: 10 }).map((_, i) => (
                        <span
                          key={i}
                          className="ht-confetti"
                          style={{
                            left: `${8 + Math.random() * 84}%`,
                            animationDelay: `${Math.random() * 0.3}s`,
                            background: i % 2 === 0 ? '#22d3ee' : '#fbbf24',
                          }}
                        />
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* ---------- Daily log ---------- */}
              <Card className="ht-glass-card border-0">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-white" style={{ fontFamily: 'var(--ht-font-display)' }}>
                    <History className="text-cyan-300 h-5 w-5" /> Daily Log
                  </CardTitle>
                  <CardDescription className="text-cyan-100/60">Your intake for {format(new Date(currentDateKey), "PPP")}.</CardDescription>
                </CardHeader>
                <CardContent>
                  {dailyLog.entries.filter(e => e.amount > 0).length > 0 ? (
                    <ul className="space-y-2 text-sm">
                      {dailyLog.entries.filter(e => e.amount > 0).map((entry, index) => (
                        <li key={index} className="flex justify-between border-b border-white/10 pb-2 text-cyan-100/60">
                          <span>{format(new Date(entry.time), 'p')}</span>
                          <span className="font-medium text-cyan-50">+1 Cup</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <div className="flex flex-col items-center py-6 text-center">
                      <Droplets className="h-10 w-10 text-cyan-300/40 mb-3 ht-float-slow" />
                      <p className="text-sm text-cyan-100/50 mb-3">No water logged yet today.</p>
                      <Button size="sm" onClick={() => changeIntake(1)} className="ht-primary-btn rounded-full">
                        <Plus className="mr-1.5 h-3.5 w-3.5" /> Log first glass
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>
        </main>

        <button
          onClick={() => changeIntake(1)}
          aria-label="Add a cup of water"
          className="ht-fab fixed bottom-6 right-6 h-16 w-16 rounded-full md:hidden flex items-center justify-center"
        >
          <Plus className="h-8 w-8 text-white" />
        </button>
      </div>

      <style jsx global>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=Inter:wght@400;500;600&display=swap');

        .ht-scope {
          --ht-font-display: 'Space Grotesk', ui-sans-serif, system-ui, sans-serif;
          --ht-font-body: 'Inter', ui-sans-serif, system-ui, sans-serif;
          font-family: var(--ht-font-body);
        }

        .ht-glass-card {
          background: linear-gradient(180deg, rgba(255,255,255,0.08), rgba(255,255,255,0.03));
          backdrop-filter: blur(20px);
          -webkit-backdrop-filter: blur(20px);
          border: 1px solid rgba(255,255,255,0.12);
          box-shadow: 0 8px 32px rgba(3, 21, 34, 0.45), inset 0 1px 0 rgba(255,255,255,0.08);
        }

        .ht-stat-card {
          background: linear-gradient(160deg, rgba(255,255,255,0.09), rgba(255,255,255,0.02));
          backdrop-filter: blur(16px);
          border: 1px solid rgba(255,255,255,0.10);
          transition: transform 0.35s cubic-bezier(0.34,1.56,0.64,1), box-shadow 0.35s ease;
        }
        .ht-stat-card:hover {
          transform: translateY(-4px);
          box-shadow: 0 12px 28px rgba(34, 211, 238, 0.18);
        }

        .ht-inset-alert {
          background: rgba(34, 211, 238, 0.08);
          border: 1px solid rgba(34, 211, 238, 0.2);
        }

        .ht-primary-btn {
          background: linear-gradient(135deg, #22d3ee, #0891b2);
          border: none;
          color: white;
          box-shadow: 0 4px 16px rgba(34, 211, 238, 0.35);
          transition: transform 0.25s cubic-bezier(0.34,1.56,0.64,1), box-shadow 0.25s ease;
        }
        .ht-primary-btn:hover { box-shadow: 0 6px 22px rgba(34, 211, 238, 0.5); transform: translateY(-2px); }
        .ht-primary-btn:active { transform: translateY(0) scale(0.96); }

        .ht-ghost-btn {
          background: rgba(255,255,255,0.06);
          border: 1px solid rgba(255,255,255,0.18);
          color: #e0fbff;
          transition: transform 0.25s cubic-bezier(0.34,1.56,0.64,1), background 0.25s ease;
        }
        .ht-ghost-btn:hover { background: rgba(255,255,255,0.12); }
        .ht-ghost-btn:active { transform: scale(0.96); }

        .ht-quick-btn {
          background: linear-gradient(160deg, rgba(255,255,255,0.10), rgba(255,255,255,0.02));
          border: 1px solid rgba(255,255,255,0.14);
          box-shadow: 0 4px 14px rgba(3,21,34,0.3);
          transition: transform 0.2s cubic-bezier(0.34,1.56,0.64,1), box-shadow 0.2s ease, background 0.2s ease;
        }
        .ht-quick-btn:hover {
          background: linear-gradient(160deg, rgba(34,211,238,0.22), rgba(255,255,255,0.04));
          box-shadow: 0 6px 18px rgba(34,211,238,0.3);
          transform: translateY(-2px);
        }
        .ht-quick-btn:active { transform: scale(0.92); }

        .ht-fab {
          background: linear-gradient(135deg, #22d3ee, #0891b2);
          box-shadow: 0 8px 24px rgba(34, 211, 238, 0.45);
          transition: transform 0.25s cubic-bezier(0.34,1.56,0.64,1);
        }
        .ht-fab:active { transform: scale(0.9); }

        .ht-bar { box-shadow: 0 0 12px rgba(34, 211, 238, 0.25); }

        .ht-progress-shine { position: relative; overflow: hidden; }

        .ht-wave { transform-origin: center; }
        .ht-wave-1 { animation: ht-wave-shift 6s linear infinite; }
        .ht-wave-2 { animation: ht-wave-shift 9s linear infinite reverse; opacity: 0.8; }
        @keyframes ht-wave-shift {
          from { transform: translateX(0); }
          to { transform: translateX(-200px); }
        }

        .ht-splash-particle { animation: ht-splash 0.7s ease-out forwards; }
        @keyframes ht-splash {
          0% { opacity: 1; transform: translateY(0) scale(1); }
          100% { opacity: 0; transform: translateY(-40px) scale(0.4); }
        }

        .ht-float-slow { animation: ht-float 7s ease-in-out infinite; }
        .ht-float-medium { animation: ht-float 5.5s ease-in-out infinite; }
        .ht-float-fast { animation: ht-float 4s ease-in-out infinite; }
        @keyframes ht-float {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-10px); }
        }

        .ht-particle { animation: ht-particle-drift ease-in-out infinite; }
        @keyframes ht-particle-drift {
          0%, 100% { transform: translateY(0) translateX(0); opacity: 0.3; }
          50% { transform: translateY(-18px) translateX(6px); opacity: 0.7; }
        }

        .ht-bgwave-1 { animation: ht-bgwave-shift 18s linear infinite; }
        .ht-bgwave-2 { animation: ht-bgwave-shift 24s linear infinite reverse; }
        @keyframes ht-bgwave-shift {
          from { transform: translateX(0); }
          to { transform: translateX(-50%); }
        }

        .ht-shine-sweep {
          position: absolute; inset: 0;
          background: linear-gradient(100deg, transparent 30%, rgba(255,255,255,0.18) 50%, transparent 70%);
          transform: translateX(-100%);
          animation: ht-shine 3.2s ease-in-out infinite;
        }
        @keyframes ht-shine {
          0% { transform: translateX(-100%); }
          60%, 100% { transform: translateX(100%); }
        }

        .ht-unlock-toast { animation: ht-toast-in 0.5s cubic-bezier(0.34,1.56,0.64,1); }
        @keyframes ht-toast-in {
          from { opacity: 0; transform: translateY(-12px) scale(0.9); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }

        .ht-confetti {
          position: absolute; top: 0; width: 5px; height: 5px; border-radius: 1px;
          animation: ht-confetti-fall 1.4s ease-in forwards;
        }
        @keyframes ht-confetti-fall {
          0% { transform: translateY(0) rotate(0deg); opacity: 1; }
          100% { transform: translateY(50px) rotate(240deg); opacity: 0; }
        }

        .ht-fade-up { animation: ht-fade-up-kf 0.6s cubic-bezier(0.16,1,0.3,1) both; }
        @keyframes ht-fade-up-kf {
          from { opacity: 0; transform: translateY(16px); }
          to { opacity: 1; transform: translateY(0); }
        }

        .ht-scope :focus-visible {
          outline: 2px solid #67e8f9;
          outline-offset: 2px;
        }

        @media (prefers-reduced-motion: reduce) {
          .ht-scope *, .ht-scope *::before, .ht-scope *::after {
            animation-duration: 0.01ms !important;
            animation-iteration-count: 1 !important;
            transition-duration: 0.01ms !important;
            scroll-behavior: auto !important;
          }
        }
      `}</style>
    </div>
  );
}
