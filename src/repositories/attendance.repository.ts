import { Attendance } from "../connection/models/attendance";
import { User } from "../connection/models/user";

export class AttendanceRepository {
  public async recordEntry(data: {
    emp_id: string;
    date_time: string;
    entry_mode: string;
  }) {
    try {
      const dateTime = new Date(data.date_time);
      const date = dateTime.toISOString().split("T")[0];

      const record = await Attendance.create({
        emp_id: data.emp_id,
        date,
        entry_mode: data.entry_mode,
        date_time: dateTime,
      });

      console.log("recordEntry:", { emp_id: data.emp_id, entry_mode: data.entry_mode, date });
      return record;
    } catch (error) {
      throw error;
    }
  }

  public async getMyAttendance(
    user_id: string,
    date?: string,
    page: number = 1,
    limit: number = 10
  ) {
    try {
      const user = await User.findByPk(user_id, { attributes: ["employee_id"] });
      if (!user || !user.employee_id) throw new Error("Employee ID not found for user");

      const where: any = { emp_id: user.employee_id };
      if (date) where.date = date;

      const offset = (page - 1) * limit;
      const { count, rows } = await Attendance.findAndCountAll({
        where,
        order: [["date_time", "DESC"]],
        offset,
        limit,
      });

      // Group by date for better frontend display
      const grouped: Record<string, { date: string; entries: any[] }> = {};
      rows.forEach((r: any) => {
        const plain = r.get({ plain: true });
        if (!grouped[plain.date]) {
          grouped[plain.date] = { date: plain.date, entries: [] };
        }
        grouped[plain.date].entries.push({
          id: plain.id,
          entry_mode: plain.entry_mode,
          date_time: plain.date_time,
        });
      });

      return {
        data: Object.values(grouped),
        totalPages: Math.ceil(count / limit),
      };
    } catch (error) {
      throw error;
    }
  }

  public async getAttendanceByEmpId(
    emp_id: string,
    date?: string,
    page: number = 1,
    limit: number = 10
  ) {
    try {
      const where: any = { emp_id };
      if (date) where.date = date;

      const offset = (page - 1) * limit;
      const { count, rows } = await Attendance.findAndCountAll({
        where,
        order: [["date_time", "DESC"]],
        offset,
        limit,
      });

      return {
        data: rows,
        totalPages: Math.ceil(count / limit),
      };
    } catch (error) {
      throw error;
    }
  }
}
