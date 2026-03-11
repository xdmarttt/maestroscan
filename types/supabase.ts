export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.4"
  }
  public: {
    Tables: {
      activity_log: {
        Row: {
          id: string
          organization_id: string
          actor_id: string
          actor_name: string
          action: string
          entity_type: string
          entity_id: string | null
          entity_name: string
          metadata: Json | null
          created_at: string
        }
        Insert: {
          id?: string
          organization_id: string
          actor_id: string
          actor_name: string
          action: string
          entity_type: string
          entity_id?: string | null
          entity_name: string
          metadata?: Json | null
          created_at?: string
        }
        Update: {
          id?: string
          organization_id?: string
          actor_id?: string
          actor_name?: string
          action?: string
          entity_type?: string
          entity_id?: string | null
          entity_name?: string
          metadata?: Json | null
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "activity_log_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activity_log_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      answer_sheets: {
        Row: {
          answers: Json | null
          created_at: string | null
          graded_at: string | null
          id: string
          organization_id: string
          percentage: number | null
          published_at: string | null
          quiz_id: string
          raw_score: number | null
          scan_image_url: string | null
          scanned_at: string | null
          status: string | null
          student_id: string
          total_points: number | null
          updated_at: string | null
        }
        Insert: {
          answers?: Json | null
          created_at?: string | null
          graded_at?: string | null
          id?: string
          organization_id: string
          percentage?: number | null
          published_at?: string | null
          quiz_id: string
          raw_score?: number | null
          scan_image_url?: string | null
          scanned_at?: string | null
          status?: string | null
          student_id: string
          total_points?: number | null
          updated_at?: string | null
        }
        Update: {
          answers?: Json | null
          created_at?: string | null
          graded_at?: string | null
          id?: string
          organization_id?: string
          percentage?: number | null
          published_at?: string | null
          quiz_id?: string
          raw_score?: number | null
          scan_image_url?: string | null
          scanned_at?: string | null
          status?: string | null
          student_id?: string
          total_points?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "answer_sheets_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "answer_sheets_quiz_id_fkey"
            columns: ["quiz_id"]
            isOneToOne: false
            referencedRelation: "quizzes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "answer_sheets_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      classes: {
        Row: {
          created_at: string | null
          description: string | null
          grade_level: string | null
          id: string
          organization_id: string
          quarter: string | null
          room: string | null
          schedule: string | null
          school_year: string
          section: string | null
          settings: Json | null
          subject: string
          teacher_id: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          grade_level?: string | null
          id?: string
          organization_id: string
          quarter?: string | null
          room?: string | null
          schedule?: string | null
          school_year: string
          section?: string | null
          settings?: Json | null
          subject: string
          teacher_id?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          description?: string | null
          grade_level?: string | null
          id?: string
          organization_id?: string
          quarter?: string | null
          room?: string | null
          schedule?: string | null
          school_year?: string
          section?: string | null
          settings?: Json | null
          subject?: string
          teacher_id?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "classes_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "classes_teacher_id_fkey"
            columns: ["teacher_id"]
            isOneToOne: false
            referencedRelation: "teachers"
            referencedColumns: ["id"]
          },
        ]
      }
      enrollments: {
        Row: {
          class_id: string
          enrolled_at: string | null
          id: string
          organization_id: string
          school_year: string
          status: string | null
          student_id: string
          updated_at: string | null
        }
        Insert: {
          class_id: string
          enrolled_at?: string | null
          id?: string
          organization_id: string
          school_year: string
          status?: string | null
          student_id: string
          updated_at?: string | null
        }
        Update: {
          class_id?: string
          enrolled_at?: string | null
          id?: string
          organization_id?: string
          school_year?: string
          status?: string | null
          student_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "enrollments_class_id_fkey"
            columns: ["class_id"]
            isOneToOne: false
            referencedRelation: "classes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "enrollments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "enrollments_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      grade_summaries: {
        Row: {
          class_id: string
          created_at: string | null
          descriptor: string | null
          id: string
          initial_grade: number | null
          organization_id: string
          pt_average: number | null
          qa_score: number | null
          quarter: string
          school_year: string
          student_id: string
          transmuted_grade: number | null
          updated_at: string | null
          ww_average: number | null
        }
        Insert: {
          class_id: string
          created_at?: string | null
          descriptor?: string | null
          id?: string
          initial_grade?: number | null
          organization_id: string
          pt_average?: number | null
          qa_score?: number | null
          quarter: string
          school_year: string
          student_id: string
          transmuted_grade?: number | null
          updated_at?: string | null
          ww_average?: number | null
        }
        Update: {
          class_id?: string
          created_at?: string | null
          descriptor?: string | null
          id?: string
          initial_grade?: number | null
          organization_id?: string
          pt_average?: number | null
          qa_score?: number | null
          quarter?: string
          school_year?: string
          student_id?: string
          transmuted_grade?: number | null
          updated_at?: string | null
          ww_average?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "grade_summaries_class_id_fkey"
            columns: ["class_id"]
            isOneToOne: false
            referencedRelation: "classes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "grade_summaries_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "grade_summaries_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      grades: {
        Row: {
          answer_sheet_id: string | null
          category: string
          class_id: string
          created_at: string | null
          id: string
          organization_id: string
          percentage: number
          quarter: string | null
          quiz_id: string | null
          remarks: string | null
          score: number
          student_id: string
          total_points: number
          updated_at: string | null
        }
        Insert: {
          answer_sheet_id?: string | null
          category: string
          class_id: string
          created_at?: string | null
          id?: string
          organization_id: string
          percentage: number
          quarter?: string | null
          quiz_id?: string | null
          remarks?: string | null
          score: number
          student_id: string
          total_points: number
          updated_at?: string | null
        }
        Update: {
          answer_sheet_id?: string | null
          category?: string
          class_id?: string
          created_at?: string | null
          id?: string
          organization_id?: string
          percentage?: number
          quarter?: string | null
          quiz_id?: string | null
          remarks?: string | null
          score?: number
          student_id?: string
          total_points?: number
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "grades_answer_sheet_id_fkey"
            columns: ["answer_sheet_id"]
            isOneToOne: false
            referencedRelation: "answer_sheets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "grades_class_id_fkey"
            columns: ["class_id"]
            isOneToOne: false
            referencedRelation: "classes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "grades_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "grades_quiz_id_fkey"
            columns: ["quiz_id"]
            isOneToOne: false
            referencedRelation: "quizzes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "grades_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          address: string | null
          created_at: string | null
          deped_school_id: string | null
          id: string
          name: string
          principal_name: string | null
          settings: Json | null
          subscription_status: string | null
          subscription_tier: string | null
          trial_ends_at: string | null
          type: string | null
          updated_at: string | null
        }
        Insert: {
          address?: string | null
          created_at?: string | null
          deped_school_id?: string | null
          id?: string
          name: string
          principal_name?: string | null
          settings?: Json | null
          subscription_status?: string | null
          subscription_tier?: string | null
          trial_ends_at?: string | null
          type?: string | null
          updated_at?: string | null
        }
        Update: {
          address?: string | null
          created_at?: string | null
          deped_school_id?: string | null
          id?: string
          name?: string
          principal_name?: string | null
          settings?: Json | null
          subscription_status?: string | null
          subscription_tier?: string | null
          trial_ends_at?: string | null
          type?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      profiles: {
        Row: {
          bio: string | null
          created_at: string | null
          full_name: string
          id: string
          onboarding_complete: boolean | null
          organization_id: string | null
          phone: string | null
          photo_url: string | null
          role: string
          updated_at: string | null
        }
        Insert: {
          bio?: string | null
          created_at?: string | null
          full_name: string
          id: string
          onboarding_complete?: boolean | null
          organization_id?: string | null
          phone?: string | null
          photo_url?: string | null
          role: string
          updated_at?: string | null
        }
        Update: {
          bio?: string | null
          created_at?: string | null
          full_name?: string
          id?: string
          onboarding_complete?: boolean | null
          organization_id?: string | null
          phone?: string | null
          photo_url?: string | null
          role?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "profiles_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      quizzes: {
        Row: {
          answer_key: Json | null
          answer_only: boolean | null
          answer_sheet_format: number | null
          category: string
          class_id: string
          created_at: string | null
          due_date: string | null
          id: string
          organization_id: string
          pdf_answer_sheet_url: string | null
          pdf_question_url: string | null
          questions: Json | null
          status: string | null
          teacher_id: string
          title: string
          total_points: number
          type: string | null
          updated_at: string | null
        }
        Insert: {
          answer_key?: Json | null
          answer_only?: boolean | null
          answer_sheet_format?: number | null
          category: string
          class_id: string
          created_at?: string | null
          due_date?: string | null
          id?: string
          organization_id: string
          pdf_answer_sheet_url?: string | null
          pdf_question_url?: string | null
          questions?: Json | null
          status?: string | null
          teacher_id: string
          title: string
          total_points: number
          type?: string | null
          updated_at?: string | null
        }
        Update: {
          answer_key?: Json | null
          answer_only?: boolean | null
          answer_sheet_format?: number | null
          category?: string
          class_id?: string
          created_at?: string | null
          due_date?: string | null
          id?: string
          organization_id?: string
          pdf_answer_sheet_url?: string | null
          pdf_question_url?: string | null
          questions?: Json | null
          status?: string | null
          teacher_id?: string
          title?: string
          total_points?: number
          type?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "quizzes_class_id_fkey"
            columns: ["class_id"]
            isOneToOne: false
            referencedRelation: "classes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quizzes_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quizzes_teacher_id_fkey"
            columns: ["teacher_id"]
            isOneToOne: false
            referencedRelation: "teachers"
            referencedColumns: ["id"]
          },
        ]
      }
      students: {
        Row: {
          access_code: string
          created_at: string | null
          full_name: string
          grade_level: string | null
          id: string
          lrn: string
          organization_id: string
          parent_contact: string | null
          parent_name: string | null
          photo_url: string | null
          profile_id: string | null
          section: string | null
          status: string | null
          updated_at: string | null
        }
        Insert: {
          access_code: string
          created_at?: string | null
          full_name: string
          grade_level?: string | null
          id?: string
          lrn: string
          organization_id: string
          parent_contact?: string | null
          parent_name?: string | null
          photo_url?: string | null
          profile_id?: string | null
          section?: string | null
          status?: string | null
          updated_at?: string | null
        }
        Update: {
          access_code?: string
          created_at?: string | null
          full_name?: string
          grade_level?: string | null
          id?: string
          lrn?: string
          organization_id?: string
          parent_contact?: string | null
          parent_name?: string | null
          photo_url?: string | null
          profile_id?: string | null
          section?: string | null
          status?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "students_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "students_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      teachers: {
        Row: {
          created_at: string | null
          email: string
          full_name: string | null
          grade_levels: string[] | null
          id: string
          organization_id: string
          profile_id: string | null
          subjects: string[] | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          email: string
          full_name?: string | null
          grade_levels?: string[] | null
          id?: string
          organization_id: string
          profile_id?: string | null
          subjects?: string[] | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          email?: string
          full_name?: string | null
          grade_levels?: string[] | null
          id?: string
          organization_id?: string
          profile_id?: string | null
          subjects?: string[] | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "teachers_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "teachers_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      custom_access_token_hook: { Args: { event: Json }; Returns: Json }
      get_org_id: { Args: never; Returns: string }
      get_user_role: { Args: never; Returns: string }
      is_admin: { Args: never; Returns: boolean }
      is_student: { Args: never; Returns: boolean }
      is_teacher: { Args: never; Returns: boolean }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
