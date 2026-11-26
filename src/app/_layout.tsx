import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { Tabs } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useState } from 'react';
import { Alert, StyleSheet, View, useColorScheme } from 'react-native';
import { Button, Card, PaperProvider, Text } from 'react-native-paper';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AppDarkTheme, AppLightTheme } from '@/constants/paperTheme';
import { getDatabase } from '@/db/database';
import { importBackupZip, resetLocalDatabase } from '@/services/backup';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const theme = colorScheme === 'dark' ? AppDarkTheme : AppLightTheme;
  const [dbReady, setDbReady] = useState(false);
  const [dbError, setDbError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [resetting, setResetting] = useState(false);

  const openDb = async () => {
    try {
      await getDatabase();
      setDbError(null);
      setDbReady(true);
    } catch (err) {
      console.error('Error initializing SQLite:', err);
      setDbReady(false);
      setDbError(err instanceof Error ? err.message : 'Error desconocido al abrir SQLite.');
    } finally {
      SplashScreen.hideAsync().catch(() => {});
    }
  };

  const handleRetry = async () => {
    setRetrying(true);
    try {
      await openDb();
    } finally {
      setRetrying(false);
    }
  };

  useEffect(() => {
    let active = true;
    getDatabase()
      .then(() => {
        if (!active) return;
        setDbError(null);
        setDbReady(true);
      })
      .catch((err) => {
        console.error('Error initializing SQLite:', err);
        if (!active) return;
        setDbReady(false);
        setDbError(err instanceof Error ? err.message : 'Error desconocido al abrir SQLite.');
      })
      .finally(() => {
        SplashScreen.hideAsync().catch(() => {});
      });
    return () => {
      active = false;
    };
  }, []);

  const handleRestoreBackup = async () => {
    setRestoring(true);
    try {
      const res = await importBackupZip();
      await openDb();
      Alert.alert(
        'Copia restaurada',
        `Base de datos recuperada (${res.importedAttachments} facturas/adjuntos importados).`
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg !== 'CANCELLED') {
        Alert.alert('Error al restaurar copia', msg);
      }
    } finally {
      setRestoring(false);
    }
  };

  const handleResetDatabase = () => {
    Alert.alert(
      'Reiniciar base de datos',
      'Esto borrará todos los pisos, movimientos y facturas de prueba de este móvil y creará una base de datos limpia desde cero. ¿Continuar?',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Reiniciar todo',
          style: 'destructive',
          onPress: async () => {
            setResetting(true);
            try {
              await resetLocalDatabase();
              await openDb();
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err);
              Alert.alert('Error al reiniciar', msg);
            } finally {
              setResetting(false);
            }
          },
        },
      ]
    );
  };

  if (!dbReady && !dbError) {
    return null;
  }

  return (
    <SafeAreaProvider>
      <PaperProvider theme={theme}>
        {dbError ? (
          <View style={[styles.errorContainer, { backgroundColor: theme.colors.background }]}>
            <Card mode="elevated" style={styles.errorCard}>
              <Card.Title
                title="Error en la base de datos"
                subtitle="No se pudo inicializar el almacenamiento local"
                left={(props) => (
                  <MaterialCommunityIcons
                    {...props}
                    name="database-alert"
                    size={28}
                    color={theme.colors.error}
                  />
                )}
              />
              <Card.Content style={{ gap: 12 }}>
                <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant }}>
                  Puedes reintentar abrir la base de datos o restaurar una copia de seguridad (.zip)
                  para recuperar tus pisos y facturas.
                </Text>
                <Text variant="bodySmall" style={{ color: theme.colors.error }}>
                  Detalle: {dbError}
                </Text>
              </Card.Content>
              <Card.Actions style={styles.errorActions}>
                <Button
                  mode="text"
                  icon="delete-forever-outline"
                  textColor={theme.colors.error}
                  loading={resetting}
                  disabled={retrying || restoring || resetting}
                  onPress={handleResetDatabase}>
                  Reiniciar BD
                </Button>
                <Button
                  mode="outlined"
                  icon="database-import-outline"
                  loading={restoring}
                  disabled={retrying || restoring || resetting}
                  onPress={handleRestoreBackup}>
                  Restaurar .zip
                </Button>
                <Button
                  mode="contained"
                  icon="refresh"
                  loading={retrying}
                  disabled={retrying || restoring || resetting}
                  onPress={handleRetry}>
                  Reintentar
                </Button>
              </Card.Actions>
            </Card>
          </View>
        ) : (
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
        )}
      </PaperProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    padding: 20,
  },
  errorCard: {
    borderRadius: 16,
  },
  errorActions: {
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
    paddingHorizontal: 16,
    paddingBottom: 16,
    gap: 8,
  },
});
