import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { Tabs } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useState } from 'react';
import { useColorScheme } from 'react-native';
import { PaperProvider } from 'react-native-paper';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AppDarkTheme, AppLightTheme } from '@/constants/paperTheme';
import { getDatabase } from '@/db/database';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const theme = colorScheme === 'dark' ? AppDarkTheme : AppLightTheme;
  const [dbReady, setDbReady] = useState(false);

  useEffect(() => {
    getDatabase()
      .then(() => setDbReady(true))
      .catch((err) => {
        console.error('Error initializing SQLite:', err);
        setDbReady(true);
      })
      .finally(() => {
        SplashScreen.hideAsync();
      });
  }, []);

  if (!dbReady) {
    return null;
  }

  return (
    <SafeAreaProvider>
      <PaperProvider theme={theme}>
        <Tabs
          screenOptions={{
            headerStyle: { backgroundColor: theme.colors.surface },
            headerTintColor: theme.colors.onSurface,
            tabBarActiveTintColor: theme.colors.primary,
            tabBarInactiveTintColor: theme.colors.onSurfaceVariant,
            tabBarStyle: {
              backgroundColor: theme.colors.surface,
              borderTopColor: theme.colors.surfaceVariant,
              height: 64,
              paddingBottom: 8,
              paddingTop: 6,
            },
            tabBarLabelStyle: {
              fontSize: 12,
              fontWeight: '600',
            },
          }}>
          <Tabs.Screen
            name="index"
            options={{
              title: 'Inicio',
              tabBarIcon: ({ color, size }) => (
                <MaterialCommunityIcons
                  name="home-variant"
                  color={typeof color === 'string' ? color : undefined}
                  size={size}
                />
              ),
            }}
          />
          <Tabs.Screen
            name="pisos"
            options={{
              title: 'Pisos',
              tabBarIcon: ({ color, size }) => (
                <MaterialCommunityIcons
                  name="office-building"
                  color={typeof color === 'string' ? color : undefined}
                  size={size}
                />
              ),
            }}
          />
          <Tabs.Screen
            name="registrar"
            options={{
              title: 'Añadir',
              tabBarIcon: ({ color, size }) => (
                <MaterialCommunityIcons
                  name="plus-circle"
                  color={typeof color === 'string' ? color : undefined}
                  size={size + 4}
                />
              ),
            }}
          />
          <Tabs.Screen
            name="fiscal"
            options={{
              title: 'Fiscal y Copia',
              tabBarIcon: ({ color, size }) => (
                <MaterialCommunityIcons
                  name="file-chart"
                  color={typeof color === 'string' ? color : undefined}
                  size={size}
                />
              ),
            }}
          />
        </Tabs>
      </PaperProvider>
    </SafeAreaProvider>
  );
}
