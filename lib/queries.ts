import { supabase } from "@/lib/supabase";

// ─── Classes ────────────────────────────────────────────────────────────────

export async function getClasses() {
  const { data, error } = await supabase
    .from("classes")
    .select(
      `
      id,
      subject,
      grade_level,
      section,
      school_year,
      quarter,
      created_at,
      enrollments(count)
    `
    )
    .eq("status" as any, "active")
    .order("created_at", { ascending: false });

  if (error) {
    console.error("getClasses error:", error);
    return [];
  }

  return (data ?? []).map((c) => ({
    id: c.id,
    subject: c.subject,
    gradeLevel: c.grade_level,
    section: c.section,
    schoolYear: c.school_year,
    quarter: c.quarter as "Q1" | "Q2" | "Q3" | "Q4",
    studentCount:
      (c.enrollments as unknown as { count: number }[])?.[0]?.count ?? 0,
    createdAt: c.created_at,
  }));
}

export async function getClassById(classId: string) {
  const { data, error } = await supabase
    .from("classes")
    .select(
      `
      id,
      subject,
      grade_level,
      section,
      school_year,
      quarter,
      teacher_id,
      created_at,
      enrollments(count)
    `
    )
    .eq("id", classId)
    .single();

  if (error || !data) return null;

  return {
    id: data.id,
    subject: data.subject,
    gradeLevel: data.grade_level,
    section: data.section,
    schoolYear: data.school_year,
    quarter: data.quarter as "Q1" | "Q2" | "Q3" | "Q4",
    teacherId: data.teacher_id,
    studentCount:
      (data.enrollments as unknown as { count: number }[])?.[0]?.count ?? 0,
    createdAt: data.created_at,
  };
}

// ─── Students ───────────────────────────────────────────────────────────────

export async function getAllStudents() {
  const { data, error } = await supabase
    .from("students")
    .select("*")
    .order("full_name", { ascending: true });

  if (error) {
    console.error("getAllStudents error:", error);
    return [];
  }

  return data ?? [];
}

export async function getStudentsByClass(classId: string) {
  const { data, error } = await supabase
    .from("enrollments")
    .select(
      `
      id,
      status,
      enrolled_at,
      students(
        id,
        full_name,
        lrn,
        grade_level,
        section,
        photo_url,
        access_code,
        status
      )
    `
    )
    .eq("class_id", classId)
    .eq("status", "active")
    .order("enrolled_at", { ascending: true });

  if (error) {
    console.error("getStudentsByClass error:", error);
    return [];
  }

  return (data ?? [])
    .map((e) => e.students)
    .filter(Boolean)
    .flat();
}

// ─── Quizzes ────────────────────────────────────────────────────────────────

export async function getAllQuizzes() {
  const { data, error } = await supabase
    .from("quizzes")
    .select("*, classes(subject, grade_level, section)")
    .order("created_at", { ascending: false });

  if (error) {
    console.error("getAllQuizzes error:", error);
    return [];
  }

  return data ?? [];
}

export async function getQuizzesByClass(classId: string) {
  const { data, error } = await supabase
    .from("quizzes")
    .select("*")
    .eq("class_id", classId)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("getQuizzesByClass error:", error);
    return [];
  }

  return data ?? [];
}

export async function getQuizById(quizId: string) {
  const { data, error } = await supabase
    .from("quizzes")
    .select("*, classes(subject, grade_level, section)")
    .eq("id", quizId)
    .single();

  if (error || !data) return null;
  return data;
}

export async function updateQuizAnswerKey(
  quizId: string,
  answerKey: Record<string, string>,
  totalPoints: number
) {
  const { error } = await supabase
    .from("quizzes")
    .update({ answer_key: answerKey, total_points: totalPoints })
    .eq("id", quizId);

  if (error) {
    console.error("updateQuizAnswerKey error:", error);
    return { error: error.message };
  }
  return { error: null };
}

// ─── Answer Sheets ──────────────────────────────────────────────────────────

export async function getAnswerSheetsByQuiz(quizId: string) {
  const { data, error } = await supabase
    .from("answer_sheets")
    .select(
      "id, student_id, raw_score, total_points, percentage, status, scanned_at, answers, students(full_name, lrn)"
    )
    .eq("quiz_id", quizId)
    .order("scanned_at", { ascending: false });

  if (error) {
    console.error("getAnswerSheetsByQuiz error:", error);
    return [];
  }

  return (data ?? []).map((s) => {
    const student = s.students as {
      full_name: string | null;
      lrn: string | null;
    } | null;
    return {
      id: s.id,
      studentId: s.student_id,
      studentName: student?.full_name ?? "Unknown Student",
      lrn: student?.lrn ?? "",
      score: s.raw_score ?? 0,
      totalPoints: s.total_points ?? 0,
      percentage: s.percentage ?? 0,
      status: s.status ?? "pending",
      scannedAt: s.scanned_at ?? null,
      answers: (s.answers as Record<string, string> | null) ?? {},
    };
  });
}

export async function saveAnswerSheet(params: {
  quizId: string;
  studentId: string;
  organizationId: string;
  answers: Record<string, string>;
  rawScore: number;
  totalPoints: number;
  percentage: number;
}) {
  const { data, error } = await supabase
    .from("answer_sheets")
    .upsert(
      {
        quiz_id: params.quizId,
        student_id: params.studentId,
        organization_id: params.organizationId,
        answers: params.answers,
        raw_score: params.rawScore,
        total_points: params.totalPoints,
        percentage: params.percentage,
        status: "graded",
        scanned_at: new Date().toISOString(),
        graded_at: new Date().toISOString(),
      },
      { onConflict: "quiz_id,student_id" }
    )
    .select()
    .single();

  if (error) {
    console.error("saveAnswerSheet error:", error);
    return { error: error.message };
  }

  return { data, error: null };
}

export async function getAnswerSheetByQuizAndStudent(quizId: string, studentId: string) {
  const { data, error } = await supabase
    .from("answer_sheets")
    .select("id, raw_score, total_points, percentage, answers, scanned_at")
    .eq("quiz_id", quizId)
    .eq("student_id", studentId)
    .maybeSingle();

  if (error) {
    console.error("getAnswerSheetByQuizAndStudent error:", error);
    return null;
  }
  return data;
}

export async function getAnswerSheetById(sheetId: string) {
  const { data, error } = await supabase
    .from("answer_sheets")
    .select(
      "id, quiz_id, student_id, answers, raw_score, total_points, percentage, status, scanned_at, students(full_name, lrn)"
    )
    .eq("id", sheetId)
    .single();

  if (error || !data) return null;

  const student = data.students as { full_name: string | null; lrn: string | null } | null;
  return {
    id: data.id,
    quizId: data.quiz_id,
    studentId: data.student_id,
    studentName: student?.full_name ?? "Unknown",
    lrn: student?.lrn ?? "",
    answers: (data.answers as Record<string, string>) ?? {},
    rawScore: data.raw_score ?? 0,
    totalPoints: data.total_points ?? 0,
    percentage: data.percentage ?? 0,
    status: data.status,
    scannedAt: data.scanned_at,
  };
}

export async function updateAnswerSheet(params: {
  sheetId: string;
  answers: Record<string, string>;
  rawScore: number;
  totalPoints: number;
  percentage: number;
}) {
  const { error } = await supabase
    .from("answer_sheets")
    .update({
      answers: params.answers,
      raw_score: params.rawScore,
      total_points: params.totalPoints,
      percentage: params.percentage,
      graded_at: new Date().toISOString(),
    })
    .eq("id", params.sheetId);

  if (error) {
    console.error("updateAnswerSheet error:", error);
    return { error: error.message };
  }
  return { error: null };
}

// ─── Dashboard Stats ────────────────────────────────────────────────────────

export async function getDashboardStats() {
  const [studentsRes, quizzesRes, classesRes, pendingRes] = await Promise.all([
    supabase
      .from("enrollments")
      .select("student_id", { count: "exact", head: true })
      .eq("status", "active"),

    supabase
      .from("quizzes")
      .select("id", { count: "exact", head: true })
      .gte(
        "created_at",
        new Date(
          new Date().getFullYear(),
          new Date().getMonth(),
          1
        ).toISOString()
      ),

    supabase
      .from("classes")
      .select("id", { count: "exact", head: true })
      .eq("status" as any, "active"),

    supabase
      .from("answer_sheets")
      .select("id", { count: "exact", head: true })
      .eq("status", "pending"),
  ]);

  return {
    totalStudents: studentsRes.count ?? 0,
    quizzesThisMonth: quizzesRes.count ?? 0,
    totalClasses: classesRes.count ?? 0,
    pendingScans: pendingRes.count ?? 0,
  };
}
