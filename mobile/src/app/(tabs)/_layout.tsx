// The three-tab shell: Home / Calendar / My Team.
//
// Matches the web app's bottom nav exactly — three tabs, not five. Messages and
// Profile live in the TopBar there and will land as stack routes here rather
// than as extra tabs, so the two clients keep the same shape.
//
// Tabs are never hidden by role. The house convention is greyed-rather-than-
// hidden: a missing element shifts everything around it and breaks muscle
// memory, so a new user still sees My Team and is told what a team unlocks
// when they open it.

import { Tabs } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';

import { theme } from '~/theme';

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: theme.greenBright,
        tabBarInactiveTintColor: theme.textFaint,
        tabBarStyle: {
          backgroundColor: theme.surface,
          borderTopColor: theme.border,
        },
        tabBarLabelStyle: { fontSize: 11 },
        sceneStyle: { backgroundColor: theme.bg },
      }}>
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          tabBarIcon: ({ color, size }) => <Ionicons name="home" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="calendar"
        options={{
          title: 'Calendar',
          tabBarIcon: ({ color, size }) => <Ionicons name="calendar" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="my-team"
        options={{
          title: 'My Team',
          tabBarIcon: ({ color, size }) => <Ionicons name="people" size={size} color={color} />,
        }}
      />
    </Tabs>
  );
}
