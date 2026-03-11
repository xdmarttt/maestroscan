import React, { useEffect, useState, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Pressable,
  RefreshControl,
  ActivityIndicator,
} from "react-native";
import { router } from "expo-router";
import { useFocusEffect } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, { FadeInDown } from "react-native-reanimated";
import { Ionicons } from "@expo/vector-icons";
import Colors from "@/constants/colors";
import { getClasses } from "@/lib/queries";

interface ClassItem {
  id: string;
  subject: string;
  gradeLevel: string | null;
  section: string | null;
  schoolYear: string;
  quarter: "Q1" | "Q2" | "Q3" | "Q4";
  studentCount: number;
  createdAt: string | null;
}

export default function ClassesTab() {
  const insets = useSafeAreaInsets();
  const [classes, setClasses] = useState<ClassItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = async () => {
    const data = await getClasses();
    setClasses(data);
    setLoading(false);
  };

  useFocusEffect(
    useCallback(() => {
      load();
    }, [])
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const renderClass = ({ item, index }: { item: ClassItem; index: number }) => (
    <Animated.View entering={FadeInDown.duration(400).delay(index * 60)}>
      <Pressable
        onPress={() => router.push({ pathname: "/class/[id]", params: { id: item.id } })}
        style={({ pressed }) => [styles.card, pressed && { opacity: 0.7 }]}
      >
        <View style={styles.cardHeader}>
          <View style={styles.subjectBadge}>
            <Ionicons name="book" size={16} color={Colors.accent} />
          </View>
          <View style={styles.cardMeta}>
            <Text style={styles.quarterBadge}>{item.quarter}</Text>
          </View>
        </View>
        <Text style={styles.subject}>{item.subject}</Text>
        <Text style={styles.detail}>
          {item.gradeLevel ? `Grade ${item.gradeLevel}` : ""}
          {item.section ? ` · ${item.section}` : ""}
        </Text>
        <View style={styles.cardFooter}>
          <Ionicons name="people-outline" size={14} color={Colors.textMuted} />
          <Text style={styles.footerText}>{item.studentCount} students</Text>
          <Text style={styles.footerDot}>·</Text>
          <Text style={styles.footerText}>{item.schoolYear}</Text>
        </View>
      </Pressable>
    </Animated.View>
  );

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Text style={styles.title}>Classes</Text>
        <Text style={styles.subtitle}>{classes.length} active classes</Text>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={Colors.accent} size="large" />
        </View>
      ) : classes.length === 0 ? (
        <View style={styles.center}>
          <Ionicons name="book-outline" size={48} color={Colors.textMuted} />
          <Text style={styles.emptyText}>No classes yet</Text>
          <Text style={styles.emptySubtext}>Create classes from the web dashboard</Text>
        </View>
      ) : (
        <FlatList
          data={classes}
          keyExtractor={(item) => item.id}
          renderItem={renderClass}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.accent} />}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  header: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 12,
  },
  title: {
    fontSize: 26,
    fontFamily: "Inter_700Bold",
    color: Colors.textPrimary,
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    color: Colors.textSecondary,
    marginTop: 4,
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
  },
  list: {
    padding: 20,
    paddingTop: 8,
    gap: 12,
  },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    gap: 8,
  },
  cardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  subjectBadge: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: Colors.accentDim,
    alignItems: "center",
    justifyContent: "center",
  },
  cardMeta: {
    flexDirection: "row",
    gap: 8,
  },
  quarterBadge: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
    color: Colors.accent,
    backgroundColor: Colors.accentDim,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    overflow: "hidden",
  },
  subject: {
    fontSize: 18,
    fontFamily: "Inter_700Bold",
    color: Colors.textPrimary,
    letterSpacing: -0.3,
  },
  detail: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    color: Colors.textSecondary,
  },
  cardFooter: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 4,
  },
  footerText: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    color: Colors.textMuted,
  },
  footerDot: {
    fontSize: 12,
    color: Colors.textMuted,
  },
  emptyText: {
    fontSize: 16,
    fontFamily: "Inter_600SemiBold",
    color: Colors.textSecondary,
  },
  emptySubtext: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    color: Colors.textMuted,
  },
});
